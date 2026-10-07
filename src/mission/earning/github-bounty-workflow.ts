/**
 * Durable GitHub-issue-bounty orchestration. Fully autonomous discovery,
 * repository AI-contribution-policy checking, and candidate-fix preparation
 * — no new earning-platform account, no KYC, no fabricated identity anywhere
 * in this file. The only credential involved is the owner's own free GitHub
 * personal access token (ZA141251SA_GITHUB_TOKEN), the exact same category of
 * credential already required for search/model providers elsewhere in the
 * launch checklist — never an "earning platform account".
 *
 * Compliance boundary (see research recorded in docs/OWNER_LAUNCH_CHECKLIST.md):
 * some bounty MARKETPLACES (e.g. Algora) prohibit automated/bot access to
 * THEIR OWN website in their own terms of service. This workflow never calls
 * such a marketplace at all — discovery, policy checks, and PR submission use
 * ONLY github.com/api.github.com, whose own terms explicitly permit automated
 * search and automated pull-request creation (this is how every legitimate
 * bot — Dependabot, Renovate, CI systems — already operates). A human/owner
 * approval gate still sits between "candidate prepared" and "PR actually
 * opened", matching the same governance pattern already used for Awin
 * publications — this is an editorial safety check, not an account/KYC step.
 *
 * Cash settlement (actually being paid for a merged bounty PR) is a SEPARATE,
 * deliberately unwired boundary: no pretend settlement adapter is installed.
 * See BountySettlementProvider below and configuredGithubBountyWorkflow().
 */
import { createHash } from 'node:crypto';
import { missionDb as db, missionId, sha256, nowIso, appendMissionAudit, type Row } from '../database';
import { assertMoneyOwner, grant, cashAccount, approveOpportunity, MoneyError, type MoneyActor } from '../money';
import { currentPolicy, checkActivity } from '../policy';
import { GithubBountyClient, GithubBountyError, classifyRepoPolicy, classifyLeadRisk, detectDuplicateTitles, configuredGithubBountyClient, type BountyLeadRaw, type PullRequestReviewSnapshotRaw } from './github-bounty-client';
import { OciBountySandboxRunner, type BountySandboxRunner } from './github-bounty-sandbox';
import { GoogleBountySolutionProvider, type BountySolutionProvider } from './github-bounty-solution-provider';

const LEDGER_PROVIDER = 'github-bounty-settlement';
const ROI_REGISTRY_KEY = 'github_issue_bounties';
function deny(code: string): never { throw new MoneyError(`bounty_${code}`); }
/** Feeds the mission-wide, already-existing continuous-learning ROI table
 * (`mission_opportunity_roi`, used generically by the workload allocator for
 * every earning class) with this integration's REAL outcomes only — never a
 * discovery event, never a simulated result. Net cents is 0 unless a real
 * hinted/confirmed amount exists; this never invents a value. */
function recordRoiAttempt() {
  const now = nowIso();
  db.run(`INSERT INTO mission_opportunity_roi (registry_key,attempts,last_updated) VALUES (?,1,?)
    ON CONFLICT(registry_key) DO UPDATE SET attempts=attempts+1, last_updated=excluded.last_updated`, [ROI_REGISTRY_KEY, now]);
}
function recordRoiOutcome(kind: 'success' | 'failure', netCents = 0) {
  const now = nowIso();
  db.run(`INSERT INTO mission_opportunity_roi (registry_key,attempts,successes,failures,total_net_cents,last_updated) VALUES (?,0,?,?,?,?)
    ON CONFLICT(registry_key) DO UPDATE SET successes=successes+excluded.successes, failures=failures+excluded.failures,
      total_net_cents=total_net_cents+excluded.total_net_cents, last_updated=excluded.last_updated`,
    [ROI_REGISTRY_KEY, kind === 'success' ? 1 : 0, kind === 'failure' ? 1 : 0, kind === 'success' ? Math.max(0, netCents) : 0, now]);
}
function required(value: string, max = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) deny('invalid_input');
  return value;
}
function executionFailureCode(error: unknown): string {
  // Only our finite internal reasons become durable evidence. Never store raw
  // provider, GitHub, Docker, repository, or model error text.
  const message = error instanceof Error ? error.message : '';
  const known = new Set(['sandbox_unavailable', 'sandbox_timeout', 'sandbox_runner_failed', 'sandbox_inspection_failed', 'sandbox_tests_failed', 'repository_not_execution_eligible', 'model_resource_not_ready', 'model_resource_not_configured', 'model_prompt_exceeds_configured_bound', 'model_proposal_not_strict_json', 'proposal_out_of_bounds', 'verification_out_of_bounds', 'issue_snapshot_out_of_bounds']);
  return known.has(message) ? message : 'execution_step_failed';
}
function get(table: string, id: string): Row {
  const row = db.get<Row>(`SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!row) deny('record_missing'); return row;
}
function event(subject: string, state: string, ref: string) {
  const sequence = Number(db.get<Row>('SELECT COALESCE(MAX(seq),0) AS n FROM mission_bounty_events')?.n) + 1;
  db.run('INSERT INTO mission_bounty_events (id,seq,subject_id,state,evidence_ref,created_at) VALUES (?,?,?,?,?,?)', [missionId('bte'), sequence, subject, state, ref, nowIso()]);
  appendMissionAudit({ actorType: 'system', actorId: null, action: `bounty.${state}`, subjectType: 'github_bounty', subjectId: subject, detail: { evidenceRef: ref } });
}
const MANDATORY_DISCLOSURE = '\n\n---\n_Disclosure: this change was researched and drafted with AI assistance and reviewed/approved by the repository-authorized submitter before being opened._';

export interface GithubBountyWorkflowOptions { dryRun?: boolean }

export class GithubBountyWorkflow {
  private readonly dryRun: boolean;
  constructor(
    private readonly github: GithubBountyClient,
    private readonly sandbox: BountySandboxRunner = new OciBountySandboxRunner(),
    private readonly solutions: BountySolutionProvider = new GoogleBountySolutionProvider(),
    options: GithubBountyWorkflowOptions = {},
  ) { this.dryRun = options.dryRun === true; }
  private live(actor: MoneyActor, assignment?: Row) {
    assertMoneyOwner(actor);
    const policy = currentPolicy();
    if (policy.killSwitch || !checkActivity('software_development', policy).allowed) deny('policy_blocked');
    if (Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities')?.n)) deny('unresolved_liability');
    if (Number(db.get<Row>("SELECT frozen FROM mission_cash_accounts WHERE id='treasury'")?.frozen)) deny('cash_frozen');
    if (assignment) {
      grant(String(assignment.agent_id));
      if (Number(cashAccount(String(assignment.agent_id)).frozen)) deny('cash_frozen');
      if (assignment.state !== 'eligible') deny('assignment_blocked');
    }
  }
  private assignment(id: string) { return get('mission_bounty_assignments', id); }
  private candidate(id: string) { return get('mission_bounty_candidates', id); }
  private opportunity(a: Row) { return get('mission_bounty_opportunities', String(a.opportunity_id)); }

  overview(actor: MoneyActor) {
    assertMoneyOwner(actor);
    return {
      accounting: 'no_settlement_adapter_configured',
      configured: { github: this.github.authenticated },
      blocked: ['settlement_not_configured', ...(this.github.authenticated ? [] : ['submission_requires_owner_github_token_with_repository_contents_write_and_pull_request_permission'])],
      note: 'Discovery and repo-policy checks work with or without a token. The isolated execution worker can produce a tested PR-ready candidate but never opens it by itself: existing owner content-hash approval remains required. Submitting then requires ZA141251SA_GITHUB_TOKEN for the legitimate GitHub user with permission to fork the upstream repository, write Contents to the user fork, and open a pull request against the upstream repository. Cash settlement for a merged bounty is not wired: no pretend adapter exists for any bounty marketplace.',
      opportunities: db.all<Row>('SELECT * FROM mission_bounty_opportunities ORDER BY observed_at DESC LIMIT 200'),
      policies: db.all<Row>('SELECT * FROM mission_bounty_policy ORDER BY checked_at DESC LIMIT 200'),
      assignments: db.all<Row>('SELECT * FROM mission_bounty_assignments ORDER BY created_at DESC LIMIT 200'),
      candidates: db.all<Row>('SELECT id,assignment_id,execution_job_id,repo_full_name,state,external_pr_number,external_pr_url,review_state,checks_state,review_summary_json,last_reviewed_at,updated_at FROM mission_bounty_candidates ORDER BY updated_at DESC LIMIT 200'),
      executionJobs: db.all<Row>('SELECT id,assignment_id,state,repository_ref,archive_sha256,candidate_id,blocked_reason,created_at,updated_at FROM mission_bounty_execution_jobs ORDER BY updated_at DESC LIMIT 200'),
    };
  }

  /** Public GitHub issue search only — no marketplace website is contacted. */
  async discover(actor: MoneyActor): Promise<Row[]> {
    this.live(actor);
    const leads: BountyLeadRaw[] = await this.github.searchBountyIssues(30);
    const duplicateTitles = detectDuplicateTitles(leads);
    // Fraud/bait-repo risk screen runs BEFORE any candidate is ever prepared, on every
    // genuinely new lead — never on already-recorded opportunities (no re-litigating history).
    const risk = new Map<string, { state: 'accepted' | 'rejected'; reason: string | null; stars: number | null; createdAt: string | null }>();
    for (const lead of leads) {
      const id = `bty_${sha256(`${lead.repoFullName}#${lead.issueNumber}`).slice(0, 24)}`;
      if (db.get('SELECT id FROM mission_bounty_opportunities WHERE id=?', [id])) continue;
      let metadata = null as Awaited<ReturnType<GithubBountyClient['fetchRepoMetadata']>> | null;
      // Metadata is advisory only. A single failed/rate-limited lookup never
      // silently grants trust, and deliberately is not retried here: the
      // client-wide token bucket/cooldown owns backoff so parallel workers do
      // not create a retry storm.
      try { metadata = await this.github.fetchRepoMetadata(lead.repoFullName); }
      catch { metadata = null; }
      const decision = classifyLeadRisk(lead, metadata, duplicateTitles.has(`${lead.repoFullName}#${lead.issueNumber}`));
      risk.set(id, { state: decision.accepted ? 'accepted' : 'rejected', reason: decision.reason, stars: metadata?.stargazersCount ?? null, createdAt: metadata?.createdAt ?? null });
    }
    return db.transaction(() => {
      this.live(actor);
      for (const lead of leads) {
        const id = `bty_${sha256(`${lead.repoFullName}#${lead.issueNumber}`).slice(0, 24)}`;
        if (!db.get('SELECT id FROM mission_bounty_opportunities WHERE id=?', [id])) {
          const r = risk.get(id) ?? { state: 'accepted' as const, reason: null, stars: null, createdAt: null };
          db.run('INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state,risk_reason,repo_stars,repo_created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [id, lead.repoFullName, lead.issueNumber, lead.issueUrl, lead.title, lead.issueBody ?? '', JSON.stringify(lead.labels), lead.hintedAmountCents, 'discovered', nowIso(), r.state, r.reason, r.stars, r.createdAt]);
          event(id, r.state === 'rejected' ? 'risk_rejected' : 'discovered', r.reason ?? lead.issueUrl);
        }
      }
      return db.all<Row>('SELECT * FROM mission_bounty_opportunities ORDER BY observed_at DESC LIMIT 200');
    });
  }

  /** Reads only the repository's own published policy files (CONTRIBUTING.md /
   * AI.md / README.md) via the GitHub Contents API. Conservative deny-list
   * classifier; silence defaults to "disclosure required", never unconditional
   * permission. The owner still reviews the exact excerpt before approving. */
  async checkPolicy(actor: MoneyActor, opportunityId: string) {
    this.live(actor);
    const opp = get('mission_bounty_opportunities', opportunityId);
    const repo = String(opp.repo_full_name);
    const files = await this.github.fetchRepoPolicyFiles(repo);
    const result = classifyRepoPolicy(repo, files, nowIso());
    return db.transaction(() => {
      this.live(actor);
      db.run(`INSERT INTO mission_bounty_policy (repo_full_name,ai_contributions_allowed,disclosure_required,policy_source,policy_excerpt,checked_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(repo_full_name) DO UPDATE SET ai_contributions_allowed=excluded.ai_contributions_allowed, disclosure_required=excluded.disclosure_required,
          policy_source=excluded.policy_source, policy_excerpt=excluded.policy_excerpt, checked_at=excluded.checked_at`,
        [repo, result.aiContributionsAllowed ? 1 : 0, result.disclosureRequired ? 1 : 0, result.policySource, result.policyExcerpt, result.checkedAt]);
      event(repo, result.aiContributionsAllowed ? 'policy_allowed' : 'policy_banned', result.policySource ?? 'no_policy_file_found');
      return db.get<Row>('SELECT * FROM mission_bounty_policy WHERE repo_full_name=?', [repo]);
    });
  }

  /** Exclusive one-agent-per-opportunity binding, same discipline as every
   * other earning workflow. Refuses assignment outright if the repo's own
   * policy explicitly bans AI contributions. */
  assign(actor: MoneyActor, input: { agentId: string; opportunityId: string }) {
    this.live(actor); grant(input.agentId);
    const op = get('mission_bounty_opportunities', input.opportunityId);
    if (String(op.risk_state) === 'rejected') deny('lead_risk_rejected');
    const policyRow = db.get<Row>('SELECT * FROM mission_bounty_policy WHERE repo_full_name=?', [String(op.repo_full_name)]);
    if (!policyRow) deny('policy_not_checked');
    if (!Number(policyRow.ai_contributions_allowed)) deny('repo_policy_prohibits_ai_contributions');
    if (Date.now() - Date.parse(String(policyRow.checked_at)) > 7 * 86400000) deny('policy_check_stale');
    return db.transaction(() => {
      this.live(actor); grant(input.agentId);
      // A prior completed/released assignment is historical and may not block
      // the agent forever. The executor's active-run partial index is the
      // durable second line of defence for concurrent assignment attempts.
      if (db.get(`SELECT a.id FROM mission_bounty_assignments a
        LEFT JOIN mission_bounty_runs r ON r.assignment_id=a.id
        WHERE a.opportunity_id=? OR (a.agent_id=? AND a.state='eligible' AND (r.id IS NULL OR r.state IN ('assigned','running')))` , [op.id, input.agentId])) deny('exclusive_assignment_conflict');
      const money = approveOpportunity(actor, { title: String(op.title), evidenceUrl: String(op.issue_url), activity: 'software_development', provider: LEDGER_PROVIDER });
      const id = missionId('bta');
      db.run(`INSERT INTO mission_bounty_assignments (id,agent_id,opportunity_id,money_opportunity_id,state,approved_by,created_at) VALUES (?,?,?,?,'eligible',?,?)`,
        [id, input.agentId, op.id, money.id, actor.id, nowIso()]);
      db.run("UPDATE mission_bounty_opportunities SET state='assigned' WHERE id=?", [op.id]);
      event(id, 'assigned', String(op.issue_url)); return this.assignment(id);
    });
  }
  revoke(actor: MoneyActor, assignmentId: string) {
    assertMoneyOwner(actor);
    db.transaction(() => { this.assignment(assignmentId); db.run("UPDATE mission_bounty_assignments SET state='revoked' WHERE id=?", [assignmentId]); event(assignmentId, 'revoked', actor.id); });
  }

  /** Creates one durable execution job. This is intentionally separate from
   * draft()/submit(): it creates no branch, commit, PR, payment, or platform
   * claim. The existing assignment, policy, MoneyActor and approval gates stay
   * authoritative. */
  queueExecution(actor: MoneyActor, assignmentId: string) {
    return db.transaction(() => {
      const assignment = this.assignment(assignmentId); this.live(actor, assignment);
      const opportunity = this.opportunity(assignment);
      if (String(opportunity.risk_state) !== 'accepted') deny('lead_risk_rejected');
      const policy = db.get<Row>('SELECT * FROM mission_bounty_policy WHERE repo_full_name=?', [String(opportunity.repo_full_name)]);
      if (!policy || !Number(policy.ai_contributions_allowed)) deny('repo_policy_prohibits_ai_contributions');
      const prior = db.get<Row>('SELECT * FROM mission_bounty_execution_jobs WHERE assignment_id=?', [assignmentId]);
      if (prior) return prior;
      const id = missionId('bex');
      const inputHash = sha256(JSON.stringify([assignmentId, opportunity.repo_full_name, opportunity.issue_number, String(policy.checked_at)]));
      db.run(`INSERT INTO mission_bounty_execution_jobs (id,assignment_id,input_hash,state,created_at,updated_at)
        VALUES (?,?,?,'queued',?,?)`, [id, assignmentId, inputHash, nowIso(), nowIso()]);
      event(id, 'execution_queued', String(opportunity.issue_url));
      return get('mission_bounty_execution_jobs', id);
    });
  }

  /** A single attempt is deliberately bounded and terminal on an uncertainty.
   * It never runs archive content in this process: the only archive consumers
   * are BountySandboxRunner.inspect()/verify(). A verified result merely calls
   * the existing draft gate; PR submission still needs explicit owner hash
   * approval and GitHub's actual permissions. */
  async executeQueued(actor: MoneyActor, limit = 1) {
    assertMoneyOwner(actor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1) deny('invalid_execution_limit');
    const job = db.get<Row>(`SELECT * FROM mission_bounty_execution_jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1`);
    if (!job) return null;
    return this.executeJob(actor, String(job.id));
  }

  async executeJob(actor: MoneyActor, jobId: string) {
    assertMoneyOwner(actor);
    const job = get('mission_bounty_execution_jobs', jobId);
    if (job.state !== 'queued') return job;
    const assignment = this.assignment(String(job.assignment_id));
    const opportunity = this.opportunity(assignment);
    try {
      this.live(actor, assignment);
      const policy = db.get<Row>('SELECT * FROM mission_bounty_policy WHERE repo_full_name=?', [String(opportunity.repo_full_name)]);
      if (!policy || !Number(policy.ai_contributions_allowed)) deny('repo_policy_prohibits_ai_contributions');
      db.transaction(() => {
        this.live(actor, this.assignment(String(job.assignment_id)));
        db.run("UPDATE mission_bounty_execution_jobs SET state='inspecting',updated_at=? WHERE id=? AND state='queued'", [nowIso(), jobId]);
        event(jobId, 'execution_inspecting', String(opportunity.issue_url));
      });

      // GitHub text/archive are untrusted inputs. Neither is executed or
      // extracted on the mission process; archive bytes are opaque here.
      const [issue, metadata] = await Promise.all([
        this.github.fetchIssueDetail(String(opportunity.repo_full_name), Number(opportunity.issue_number)),
        this.github.fetchRepoMetadata(String(opportunity.repo_full_name)),
      ]);
      const baseBranch = metadata.defaultBranch;
      if (!baseBranch || metadata.archived || metadata.fork) throw new Error('repository_not_execution_eligible');
      const archive = await this.github.downloadRepositoryArchive(String(opportunity.repo_full_name), baseBranch);
      const archiveHash = createHash('sha256').update(archive).digest('hex');
      const inspection = await this.sandbox.inspect(archive);
      if (!inspection.ok) throw new Error('sandbox_inspection_failed');
      const issueSnapshot = JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels, issueUrl: issue.issueUrl });
      if (Buffer.byteLength(issueSnapshot, 'utf8') > 32_000) throw new Error('issue_snapshot_out_of_bounds');
      db.transaction(() => {
        this.live(actor, this.assignment(String(job.assignment_id)));
        db.run(`UPDATE mission_bounty_execution_jobs SET state='generating',issue_snapshot_json=?,repository_ref=?,archive_sha256=?,inspection_json=?,updated_at=?
          WHERE id=? AND state='inspecting'`, [issueSnapshot, baseBranch, archiveHash, JSON.stringify({ summary: inspection.summary.slice(0, 16000), files: inspection.files.slice(0, 200) }), nowIso(), jobId]);
        event(jobId, 'execution_inspected', archiveHash);
      });

      // Generation spends only through the existing resource call/wallet gate.
      // No model output is accepted until it passes the proposal validator.
      this.live(actor, this.assignment(String(job.assignment_id)));
      if (!this.solutions.available(String(assignment.agent_id))) throw new Error('model_resource_not_ready');
      const proposal = await this.solutions.generate({ jobId, agentId: String(assignment.agent_id), repoFullName: String(opportunity.repo_full_name), issueNumber: Number(opportunity.issue_number), issueTitle: issue.title, issueBody: issue.body, labels: issue.labels, inspection });
      const proposalJson = JSON.stringify(proposal);
      if (Buffer.byteLength(proposalJson, 'utf8') > 600_000) throw new Error('proposal_out_of_bounds');
      db.transaction(() => {
        this.live(actor, this.assignment(String(job.assignment_id)));
        db.run("UPDATE mission_bounty_execution_jobs SET state='verifying',proposal_json=?,updated_at=? WHERE id=? AND state='generating'", [proposalJson, nowIso(), jobId]);
        event(jobId, 'execution_verifying', sha256(proposalJson));
      });

      // Explicit argv tests run only in the OCI sandbox. The runner is
      // networkless, non-root, no-capability and resource/time bounded.
      this.live(actor, this.assignment(String(job.assignment_id)));
      const verification = await this.sandbox.verify(archive, proposal);
      const verificationJson = JSON.stringify({ ok: verification.ok, summary: verification.summary.slice(0, 16000), reason: verification.reason ?? null, tests: verification.tests.map(test => ({ argv: test.argv, exitCode: test.exitCode, output: test.output.slice(0, 16000) })) });
      if (Buffer.byteLength(verificationJson, 'utf8') > 80_000) throw new Error('verification_out_of_bounds');
      if (!verification.ok) {
        return this.blockExecution(actor, jobId, 'sandbox_tests_failed', verificationJson);
      }
      db.transaction(() => {
        this.live(actor, this.assignment(String(job.assignment_id)));
        db.run("UPDATE mission_bounty_execution_jobs SET state='verified',verification_json=?,updated_at=? WHERE id=? AND state='verifying'", [verificationJson, nowIso(), jobId]);
        event(jobId, 'execution_verified', sha256(verificationJson));
      });

      const fingerprint = sha256(JSON.stringify([jobId, proposal.files[0].path, proposal.files[0].content]));
      const candidate = this.draft(actor, String(assignment.id), {
        key: `execution:${jobId}:${fingerprint.slice(0, 24)}`,
        baseBranch,
        branchName: `akbaral/bounty-${Number(opportunity.issue_number)}-${fingerprint.slice(0, 10)}`,
        filePath: proposal.files[0].path, fileContent: proposal.files[0].content,
        commitMessage: proposal.commitMessage, prTitle: proposal.prTitle, prBody: proposal.prBody,
      });
      return db.transaction(() => {
        this.live(actor, this.assignment(String(job.assignment_id)));
        db.run('UPDATE mission_bounty_candidates SET execution_job_id=? WHERE id=? AND (execution_job_id IS NULL OR execution_job_id=?)', [jobId, candidate.id, jobId]);
        db.run("UPDATE mission_bounty_execution_jobs SET state='drafted',candidate_id=?,updated_at=? WHERE id=? AND state='verified'", [candidate.id, nowIso(), jobId]);
        event(jobId, 'execution_drafted', String(candidate.id));
        return get('mission_bounty_execution_jobs', jobId);
      });
    } catch (error) {
      // Never persist provider/GitHub error payloads: they can contain untrusted
      // text or secrets. A blocked job is an honest operator-visible outcome;
      // it prevents unsafe automatic redispatch after a possibly uncertain call.
      return this.blockExecution(actor, jobId, executionFailureCode(error));
    }
  }

  private blockExecution(actor: MoneyActor, jobId: string, reason: string, verificationJson?: string) {
    return db.transaction(() => {
      const current = get('mission_bounty_execution_jobs', jobId);
      const assignment = this.assignment(String(current.assignment_id)); this.live(actor, assignment);
      if (['drafted', 'blocked', 'failed'].includes(String(current.state))) return current;
      db.run("UPDATE mission_bounty_execution_jobs SET state='blocked',blocked_reason=?,verification_json=COALESCE(?,verification_json),updated_at=? WHERE id=?", [reason.slice(0, 120), verificationJson ?? null, nowIso(), jobId]);
      event(jobId, 'execution_blocked', reason.slice(0, 120));
      return get('mission_bounty_execution_jobs', jobId);
    });
  }

  /** Readiness check used by the parallel executor. It is deliberately public
   * so a blocked worker does not fetch an archive or call a model merely to
   * discover that the pinned sandbox/resource is absent. */
  async executionReadiness(actor: MoneyActor, assignmentId: string): Promise<{ ready: boolean; reason: string | null }> {
    const assignment = this.assignment(assignmentId);
    this.live(actor, assignment);
    if (!(await this.sandbox.available())) return { ready: false, reason: 'sandbox_unavailable' };
    if (!this.solutions.available(String(assignment.agent_id))) return { ready: false, reason: 'model_resource_not_ready' };
    return { ready: true, reason: null };
  }

  /** Scheduler-facing, fail-closed autonomous execution pass. If the
   * deployment has not provisioned a digest-pinned OCI image or a legitimately
   * billed/configured model resource, it performs no model call, archive fetch,
   * repository execution, PR mutation, or synthetic fallback. */
  async runExecutionCycle(actor: MoneyActor): Promise<{ attempted: boolean; queued: boolean; state: string | null; reason: string | null }> {
    assertMoneyOwner(actor);
    let job = db.get<Row>("SELECT * FROM mission_bounty_execution_jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1");
    let queued = false;
    if (!job) {
      const assignment = db.get<Row>(`SELECT a.* FROM mission_bounty_assignments a
        LEFT JOIN mission_bounty_execution_jobs j ON j.assignment_id=a.id
        WHERE a.state='eligible' AND j.id IS NULL ORDER BY a.created_at,a.id LIMIT 1`);
      if (!assignment) return { attempted: false, queued: false, state: null, reason: 'no_eligible_assignment' };
      if (!(await this.sandbox.available())) return { attempted: false, queued: false, state: null, reason: 'sandbox_unavailable' };
      if (!this.solutions.available(String(assignment.agent_id))) return { attempted: false, queued: false, state: null, reason: 'model_resource_not_ready' };
      job = this.queueExecution(actor, String(assignment.id)); queued = true;
    }
    const assignment = this.assignment(String(job.assignment_id));
    if (!(await this.sandbox.available())) return { attempted: false, queued, state: String(job.state), reason: 'sandbox_unavailable' };
    if (!this.solutions.available(String(assignment.agent_id))) return { attempted: false, queued, state: String(job.state), reason: 'model_resource_not_ready' };
    const result = await this.executeJob(actor, String(job.id));
    return { attempted: true, queued, state: String(result.state), reason: result.blocked_reason ? String(result.blocked_reason) : null };
  }

  /** Prepares a candidate fix — a single file change, commit message, and PR
   * title/body. NOT submitted anywhere yet. The mandatory disclosure line is
   * always appended server-side; callers cannot omit it. */
  draft(actor: MoneyActor, assignmentId: string, input: { key: string; baseBranch: string; branchName: string; filePath: string; fileContent: string; commitMessage: string; prTitle: string; prBody: string }) {
    required(input.key, 200); required(input.baseBranch, 200); required(input.branchName, 200);
    required(input.filePath, 400); required(input.commitMessage, 400); required(input.prTitle, 250);
    if (typeof input.fileContent !== 'string' || input.fileContent.length > 500000) deny('invalid_input');
    if (typeof input.prBody !== 'string' || input.prBody.length > 50000) deny('invalid_input');
    return db.transaction(() => {
      const a = this.assignment(assignmentId); this.live(actor, a);
      const body = input.prBody + MANDATORY_DISCLOSURE;
      const fingerprint = sha256(JSON.stringify([assignmentId, input.filePath, input.fileContent, input.commitMessage, input.prTitle, body]));
      const old = db.get<Row>('SELECT * FROM mission_bounty_candidates WHERE idempotency_key=?', [input.key]);
      if (old) { if (old.input_hash !== fingerprint) deny('idempotency_conflict'); return old; }
      const opp = this.opportunity(a);
      const id = missionId('btc');
      db.run(`INSERT INTO mission_bounty_candidates
        (id,assignment_id,idempotency_key,input_hash,repo_full_name,base_branch,branch_name,file_path,file_content,commit_message,pr_title,pr_body,content_hash,state,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'eligible',?)`,
        [id, assignmentId, input.key, fingerprint, String(opp.repo_full_name), input.baseBranch, input.branchName, input.filePath, input.fileContent, input.commitMessage, input.prTitle, body, fingerprint, nowIso()]);
      event(id, 'eligible', fingerprint);
      recordRoiAttempt(); // a real prepared attempt, feeding the mission-wide continuous-learning ROI table
      return this.candidate(id);
    });
  }

  /** Owner reviews the exact prepared diff/PR text before anything is opened
   * publicly — an editorial safety gate, not an account or KYC step. */
  approveCandidate(actor: MoneyActor, candidateId: string, contentHash: string) {
    return db.transaction(() => {
      const c = this.candidate(candidateId); this.live(actor, this.assignment(String(c.assignment_id)));
      if (c.state !== 'eligible' || !contentHash || c.content_hash !== contentHash) deny('approval_content_mismatch');
      db.run('UPDATE mission_bounty_candidates SET approved_hash=?,approved_by=? WHERE id=?', [contentHash, actor.id, candidateId]);
      event(candidateId, 'owner_authorized', contentHash); return this.candidate(candidateId);
    });
  }

  /** Forks the upstream repo (idempotent), pushes the branch, and opens the
   * PR. Every mutation is gated by a fresh live()+state check immediately
   * before it fires, matching the Awin publish() discipline. */
  async submit(actor: MoneyActor, candidateId: string) {
    // Hard boundary: dry-run never reaches even the first GitHub mutation.
    // Keep this check before loading candidate state so no caller can bypass
    // the guard by constructing a malformed or pre-approved candidate.
    if (this.dryRun) deny('dry_run_submission_blocked');
    const c = this.candidate(candidateId), a = this.assignment(String(c.assignment_id)); this.live(actor, a);
    if (c.state !== 'eligible' || c.approved_hash !== c.content_hash || !c.approved_by) deny('owner_approval_required');
    db.transaction(() => { this.live(actor, this.assignment(String(c.assignment_id))); db.run("UPDATE mission_bounty_candidates SET state='submitting',updated_at=? WHERE id=? AND state='eligible'", [nowIso(), candidateId]); });
    let open = true;
    try {
      const authorize = () => { if (!open) deny('dispatch_closed'); this.live(actor, this.assignment(String(c.assignment_id))); if (this.candidate(candidateId).state !== 'submitting') deny('dispatch_closed'); };
      const repo = String(c.repo_full_name);
      await this.github.ensureFork(repo, authorize);
      const login = await this.github.currentUserLogin();
      const baseSha = await this.github.getBranchSha(repo, String(c.base_branch));
      const forkRepo = `${login}/${repo.split('/')[1]}`;
      try { await this.github.createBranch(forkRepo, String(c.branch_name), baseSha, authorize); }
      catch (error) { if (!(error instanceof GithubBountyError && error.code === 'github_validation_failed')) throw error; /* branch may already exist from a prior partial attempt */ }
      await this.github.putFile(forkRepo, String(c.branch_name), String(c.file_path), String(c.file_content), String(c.commit_message), authorize);
      const pr = await this.github.createPullRequest(repo, login, String(c.branch_name), String(c.base_branch), String(c.pr_title), String(c.pr_body), authorize);
      return db.transaction(() => {
        this.live(actor, this.assignment(String(c.assignment_id)));
        db.run("UPDATE mission_bounty_candidates SET state='submitted',external_pr_number=?,external_pr_url=?,external_head_sha=?,updated_at=? WHERE id=? AND state='submitting'",
          [pr.number, pr.url, pr.headSha, nowIso(), candidateId]);
        event(candidateId, 'submitted', pr.url); return this.candidate(candidateId);
      });
    } catch (error) {
      db.transaction(() => {
        const state = error instanceof GithubBountyError && !error.effectMayHaveOccurred ? 'blocked' : 'unknown_submit';
        db.run('UPDATE mission_bounty_candidates SET state=?,updated_at=? WHERE id=? AND state=\'submitting\'', [state, nowIso(), candidateId]);
        event(candidateId, state, 'read_only_reconciliation_required');
        recordRoiOutcome('failure'); // real failed submission attempt, not a discovery/simulation event
      });
      throw new MoneyError('bounty_submission_blocked_or_uncertain');
    } finally { open = false; }
  }

  /** Read-only PR status refresh. Real, externally verifiable: GitHub's own
   * `merged` boolean is the sole source of truth — never inferred locally. */
  async trackPullRequest(actor: MoneyActor, candidateId: string) {
    assertMoneyOwner(actor);
    const c = this.candidate(candidateId);
    if (!['submitted', 'merged', 'closed_unmerged'].includes(String(c.state)) || !c.external_pr_number) deny('not_submitted');
    const status = await this.github.getPullRequest(String(c.repo_full_name), Number(c.external_pr_number));
    return db.transaction(() => {
      assertMoneyOwner(actor);
      if (status.headSha !== String(c.external_head_sha) && status.state === 'open') {
        // Upstream force-pushed/rebased our branch reference elsewhere; keep tracking but do not silently trust a different head.
      }
      const previousState = String(c.state);
      db.run("UPDATE mission_bounty_candidates SET state=?,updated_at=? WHERE id=?", [status.state, nowIso(), candidateId]);
      event(candidateId, status.state, status.url);
      // Only the first real observed transition counts — re-polling an already-merged/closed
      // PR must never double-count the same GitHub-verified outcome.
      if (previousState !== status.state && (status.state === 'merged' || status.state === 'closed_unmerged')) {
        if (status.state === 'merged') {
          const a = this.assignment(String(c.assignment_id));
          const opp = this.opportunity(a);
          const hinted = opp.hinted_amount_cents == null ? 0 : Number(opp.hinted_amount_cents);
          recordRoiOutcome('success', Number.isFinite(hinted) ? hinted : 0); // merged is real, externally-verified completed work; net cents is a hint only, never fabricated cash
        } else {
          recordRoiOutcome('failure');
        }
      }
      return this.candidate(candidateId);
    });
  }

  /** Persists an externally observed, read-only review/check snapshot. This is
   * intentionally NOT an approval primitive: GitHub review/check evidence can
   * inform a later correction, but never authorizes a new write or payment. */
  private recordPullRequestReviewSnapshot(actor: MoneyActor, candidateId: string, snapshot: PullRequestReviewSnapshotRaw): Row | null {
    return db.transaction(() => {
      assertMoneyOwner(actor);
      const current = this.candidate(candidateId);
      // A concurrent/manual tracker may have already terminally recorded this
      // PR. Keep the first terminal evidence immutable and do not double-count
      // ROI or overwrite a newer terminal result.
      if (current.state !== 'submitted') return null;
      if (snapshot.repoFullName !== String(current.repo_full_name) || Number(current.external_pr_number) !== snapshot.number) deny('pull_request_mismatch');
      const summary = JSON.stringify({
        source: 'github_rest', state: snapshot.state, reviewState: snapshot.reviewState,
        checksState: snapshot.checksState, reviewCount: snapshot.reviewCount,
        checkRunCount: snapshot.checkRunCount, observedAt: snapshot.observedAt,
      });
      const nextState = snapshot.state === 'open' ? 'submitted' : snapshot.state;
      db.run(`UPDATE mission_bounty_candidates
        SET state=?, review_state=?, checks_state=?, review_summary_json=?, last_reviewed_at=?, updated_at=?
        WHERE id=? AND state='submitted'`,
        [nextState, snapshot.reviewState, snapshot.checksState, summary, snapshot.observedAt, nowIso(), candidateId]);
      event(candidateId, nextState === 'submitted' ? 'review_snapshot' : nextState, snapshot.url);
      if (nextState === 'merged') {
        const a = this.assignment(String(current.assignment_id));
        const opp = this.opportunity(a);
        const hinted = opp.hinted_amount_cents == null ? 0 : Number(opp.hinted_amount_cents);
        // A GitHub-verified merge is completed work. The amount remains only a
        // non-cash hint; no receipt, wallet credit, or revenue is created here.
        recordRoiOutcome('success', Number.isFinite(hinted) ? hinted : 0);
      } else if (nextState === 'closed_unmerged') {
        recordRoiOutcome('failure');
      }
      return this.candidate(candidateId);
    });
  }

  /** One bounded passive monitoring pass for submitted PRs. It requires no
   * owner request after the original PR exists and performs no mutation on
   * GitHub. Errors are separately audited and leave candidate state unchanged
   * so the scheduler can retry later without assuming a review/merge happened. */
  async refreshSubmittedPullRequests(actor: MoneyActor, limit = 1): Promise<{ attempted: number; observed: number; merged: number; closedUnmerged: number; reviewsApproved: number; changesRequested: number; checksPassing: number; checksFailing: number; failed: number }> {
    assertMoneyOwner(actor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) deny('invalid_monitor_limit');
    const candidates = db.all<Row>(`SELECT id,repo_full_name,external_pr_number FROM mission_bounty_candidates
      WHERE state='submitted' AND external_pr_number IS NOT NULL
      ORDER BY CASE WHEN last_reviewed_at IS NULL THEN 0 ELSE 1 END, last_reviewed_at ASC, updated_at ASC LIMIT ?`, [limit]);
    let attempted = 0, observed = 0, merged = 0, closedUnmerged = 0, reviewsApproved = 0, changesRequested = 0, checksPassing = 0, checksFailing = 0, failed = 0;
    for (const candidate of candidates) {
      attempted++;
      try {
        const snapshot = await this.github.getPullRequestReviewSnapshot(String(candidate.repo_full_name), Number(candidate.external_pr_number));
        const persisted = this.recordPullRequestReviewSnapshot(actor, String(candidate.id), snapshot);
        if (!persisted) continue;
        observed++;
        if (snapshot.state === 'merged') merged++;
        if (snapshot.state === 'closed_unmerged') closedUnmerged++;
        if (snapshot.reviewState === 'approved') reviewsApproved++;
        if (snapshot.reviewState === 'changes_requested') changesRequested++;
        if (snapshot.checksState === 'passing') checksPassing++;
        if (snapshot.checksState === 'failing') checksFailing++;
      } catch (error) {
        failed++;
        const code = error instanceof GithubBountyError ? error.code : 'github_monitor_failed';
        // No raw upstream body/error is retained: it may include untrusted PR
        // text. The durable retry signal is the still-submitted candidate.
        try { event(String(candidate.id), 'review_refresh_failed', code.slice(0, 120)); } catch { /* audit failure must not disguise the original monitor failure */ }
      }
    }
    return { attempted, observed, merged, closedUnmerged, reviewsApproved, changesRequested, checksPassing, checksFailing, failed };
  }
}

/** No settlement adapter was selected by the owner. Do not install pretend
 * adapters. A merged PR (mission_bounty_candidates.state='merged') is real,
 * externally verified completed work — it is NOT, by itself, verified cash;
 * crediting mission treasury still requires independently verified payout
 * evidence through the exact same acceptReceipt()/verifyBoundMoneyReceipt()
 * boundary every other earning provider goes through. No such adapter exists
 * yet for any bounty marketplace, so no bounty PR — merged or not — can enter
 * mission cash today. */
export function reserveGithubBountyRequest() {
  db.transaction(() => {
    const now = nowIso(), cutoff = new Date(Date.now() - 60000).toISOString();
    const cooldown = db.get<Row>("SELECT until_at FROM mission_bounty_api_cooldown WHERE id='global'");
    if (cooldown && String(cooldown.until_at) > now) deny('rate_limited');
    db.run('DELETE FROM mission_bounty_api_requests WHERE started_at<=?', [cutoff]);
    if (Number(db.get<Row>('SELECT COUNT(*) AS n FROM mission_bounty_api_requests')?.n) >= 30) deny('rate_limited');
    db.run('INSERT INTO mission_bounty_api_requests (id,started_at) VALUES (?,?)', [missionId('btr'), now]);
  });
}
export function recordGithubBountyCooldown(delayMs: number) {
  const until = new Date(Math.min(Date.now() + Math.max(60000, delayMs), 253402300799999)).toISOString();
  db.transaction(() => {
    const old = db.get<Row>("SELECT until_at FROM mission_bounty_api_cooldown WHERE id='global'");
    if (!old) db.run("INSERT INTO mission_bounty_api_cooldown (id,until_at) VALUES ('global',?)", [until]);
    else if (String(old.until_at) < until) db.run("UPDATE mission_bounty_api_cooldown SET until_at=? WHERE id='global'", [until]);
  });
}
export function configuredGithubBountyWorkflow() {
  return new GithubBountyWorkflow(
    configuredGithubBountyClient(process.env, { beforeRequest: reserveGithubBountyRequest, onRateLimit: recordGithubBountyCooldown }),
    new OciBountySandboxRunner(),
    new GoogleBountySolutionProvider(),
    { dryRun: process.env.DRY_RUN === 'true' },
  );
}
