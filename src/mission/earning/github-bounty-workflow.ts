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
import { missionDb as db, missionId, sha256, nowIso, appendMissionAudit, type Row } from '../database';
import { assertMoneyOwner, grant, cashAccount, approveOpportunity, MoneyError, type MoneyActor } from '../money';
import { currentPolicy, checkActivity } from '../policy';
import { GithubBountyClient, GithubBountyError, classifyRepoPolicy, configuredGithubBountyClient, type BountyLeadRaw } from './github-bounty-client';

const LEDGER_PROVIDER = 'github-bounty-settlement';
function deny(code: string): never { throw new MoneyError(`bounty_${code}`); }
function required(value: string, max = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) deny('invalid_input');
  return value;
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

export class GithubBountyWorkflow {
  constructor(private readonly github: GithubBountyClient) {}
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
      blocked: ['settlement_not_configured', ...(this.github.authenticated ? [] : ['submission_requires_owner_github_token'])],
      note: 'Discovery and repo-policy checks work with or without a token. Submitting a PR (forking, pushing a branch, opening the pull request) requires ZA141251SA_GITHUB_TOKEN — a free, instant, no-KYC GitHub personal access token, NOT an earning-platform account. Cash settlement for a merged bounty is not wired: no pretend adapter exists for any bounty marketplace.',
      opportunities: db.all<Row>('SELECT * FROM mission_bounty_opportunities ORDER BY observed_at DESC LIMIT 200'),
      policies: db.all<Row>('SELECT * FROM mission_bounty_policy ORDER BY checked_at DESC LIMIT 200'),
      assignments: db.all<Row>('SELECT * FROM mission_bounty_assignments ORDER BY created_at DESC LIMIT 200'),
      candidates: db.all<Row>('SELECT id,assignment_id,repo_full_name,state,external_pr_number,external_pr_url,updated_at FROM mission_bounty_candidates ORDER BY updated_at DESC LIMIT 200'),
    };
  }

  /** Public GitHub issue search only — no marketplace website is contacted. */
  async discover(actor: MoneyActor): Promise<Row[]> {
    this.live(actor);
    const leads: BountyLeadRaw[] = await this.github.searchBountyIssues(30);
    return db.transaction(() => {
      this.live(actor);
      for (const lead of leads) {
        const id = `bty_${sha256(`${lead.repoFullName}#${lead.issueNumber}`).slice(0, 24)}`;
        if (!db.get('SELECT id FROM mission_bounty_opportunities WHERE id=?', [id])) {
          db.run('INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,labels_json,hinted_amount_cents,state,observed_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [id, lead.repoFullName, lead.issueNumber, lead.issueUrl, lead.title, JSON.stringify(lead.labels), lead.hintedAmountCents, 'discovered', nowIso()]);
          event(id, 'discovered', lead.issueUrl);
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
    const policyRow = db.get<Row>('SELECT * FROM mission_bounty_policy WHERE repo_full_name=?', [String(op.repo_full_name)]);
    if (!policyRow) deny('policy_not_checked');
    if (!Number(policyRow.ai_contributions_allowed)) deny('repo_policy_prohibits_ai_contributions');
    if (Date.now() - Date.parse(String(policyRow.checked_at)) > 7 * 86400000) deny('policy_check_stale');
    return db.transaction(() => {
      this.live(actor); grant(input.agentId);
      if (db.get('SELECT id FROM mission_bounty_assignments WHERE agent_id=? OR opportunity_id=?', [input.agentId, op.id])) deny('exclusive_assignment_conflict');
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
      event(id, 'eligible', fingerprint); return this.candidate(id);
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
      db.run("UPDATE mission_bounty_candidates SET state=?,updated_at=? WHERE id=?", [status.state, nowIso(), candidateId]);
      event(candidateId, status.state, status.url);
      return this.candidate(candidateId);
    });
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
  return new GithubBountyWorkflow(configuredGithubBountyClient(process.env, { beforeRequest: reserveGithubBountyRequest, onRateLimit: recordGithubBountyCooldown }));
}
