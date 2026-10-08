/**
 * Durable, bounded GitHub bounty executor.
 *
 * This module owns the scale boundary: discovery and policy screening produce
 * a finite viable set, assignment is capped at min(viable, configured N), and
 * each run has a durable lease. It can draft candidates, but it never calls
 * GithubBountyWorkflow.submit(). That mutation remains an owner-approved,
 * dry-run-guarded endpoint outside this executor.
 */
import { missionDb as db, missionId, type Row } from '../database';
import type { MoneyActor } from '../money';
import type { GithubBountyWorkflow } from './github-bounty-workflow';
import { filterInScopeRepos } from './github-bounty-scope-gate';

export const DEFAULT_BOUNTY_MAX_CONCURRENCY = 8;
const DEFAULT_LEASE_MS = 30 * 60 * 1000;
const MAX_BOUNTY_CONCURRENCY = 64;

export interface ParallelBountyOptions {
  maxConcurrency?: number;
  leaseMs?: number;
  now?: () => Date;
  /** Explicit mode marker for callers/observability; submit is unreachable in either mode. */
  dryRun?: boolean;
}

export interface BountyRunOutcome {
  runId: string;
  assignmentId: string;
  opportunityId: string;
  agentId: string;
  state: 'assigned' | 'running' | 'blocked' | 'completed' | 'released';
  reason: string | null;
  candidateId: string | null;
  executionJobId: string | null;
}

export interface ParallelBountyResult {
  maxConcurrency: number;
  discovered: number;
  accepted: number;
  rejected: number;
  policyChecked: number;
  policyAllowed: number;
  policyBanned: number;
  availableViableIssues: number;
  availableAgents: number;
  assigned: number;
  idleIssues: number;
  idleReason: 'no_viable_opportunity' | 'no_available_agent' | null;
  leasesReleased: number;
  runs: BountyRunOutcome[];
}

function configuredConcurrency(value?: number): number {
  const candidate = value ?? Number(process.env.ZA141251SA_BOUNTY_MAX_CONCURRENCY ?? DEFAULT_BOUNTY_MAX_CONCURRENCY);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > MAX_BOUNTY_CONCURRENCY) return DEFAULT_BOUNTY_MAX_CONCURRENCY;
  return candidate;
}
function finiteReason(value: unknown): string {
  const allowed = new Set([
    'sandbox_unavailable', 'model_resource_not_ready', 'execution_step_failed',
    'sandbox_timeout', 'sandbox_runner_failed', 'sandbox_inspection_failed',
    'sandbox_tests_failed', 'repository_not_execution_eligible', 'model_resource_not_configured',
    'model_prompt_exceeds_configured_bound', 'model_proposal_not_strict_json',
    'proposal_out_of_bounds', 'verification_out_of_bounds', 'issue_snapshot_out_of_bounds',
    'lease_expired', 'parallel_execution_failed', 'assignment_failed', 'policy_check_failed', 'scope_gate_blocked',
  ]);
  const reason = typeof value === 'string' ? value : '';
  return allowed.has(reason) ? reason : 'parallel_execution_failed';
}
function runOutcome(row: Row): BountyRunOutcome {
  return {
    runId: String(row.id), assignmentId: String(row.assignment_id), opportunityId: String(row.opportunity_id),
    agentId: String(row.agent_id), state: String(row.state) as BountyRunOutcome['state'],
    reason: row.reason == null ? null : String(row.reason),
    candidateId: row.candidate_id == null ? null : String(row.candidate_id),
    executionJobId: row.execution_job_id == null ? null : String(row.execution_job_id),
  };
}

/** Release assigned/running work whose lease is no longer valid. The update is
 * conditional and transactional, so two workers cannot both release the same
 * run or accidentally release a newly completed run. */
export function releaseExpiredBountyRuns(at = new Date()): number {
  const timestamp = at.toISOString();
  return db.transaction(() => {
    const expired = db.all<Row>(`SELECT id,assignment_id FROM mission_bounty_runs
      WHERE state IN ('assigned','running') AND lease_expires_at <= ?`, [timestamp]);
    for (const row of expired) {
      db.run(`UPDATE mission_bounty_runs SET state='released',reason='lease_expired',released_at=?,updated_at=?
        WHERE id=? AND state IN ('assigned','running')`, [timestamp, timestamp, String(row.id)]);
      db.run("UPDATE mission_bounty_assignments SET state='eligible' WHERE id=? AND state='eligible'", [String(row.assignment_id)]);
    }
    return expired.length;
  });
}

async function mapLimit<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return results;
}

function availableAgentRows(): Row[] {
  return db.all<Row>(`SELECT ag.id FROM mission_agents ag
    WHERE ag.status='active'
      AND NOT EXISTS (
        SELECT 1 FROM mission_bounty_assignments a
        LEFT JOIN mission_bounty_runs r ON r.assignment_id=a.id
        WHERE a.agent_id=ag.id AND a.state='eligible'
          AND (r.id IS NULL OR r.state IN ('assigned','running'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM mission_bounty_runs r2 WHERE r2.agent_id=ag.id AND r2.state IN ('assigned','running')
      )
    ORDER BY ag.id`);
}

function newRun(assignment: Row, leaseMs: number, at: Date): Row {
  const now = at.toISOString();
  const expiry = new Date(at.getTime() + leaseMs).toISOString();
  return db.transaction(() => {
    const id = missionId('brun');
    db.run(`INSERT INTO mission_bounty_runs
      (id,assignment_id,opportunity_id,agent_id,state,lease_expires_at,created_at,updated_at)
      VALUES (?,?,?,?, 'assigned',?,?,?)`,
      [id, String(assignment.id), String(assignment.opportunity_id), String(assignment.agent_id), expiry, now, now]);
    return db.get<Row>('SELECT * FROM mission_bounty_runs WHERE id=?', [id])!;
  });
}

function updateRun(runId: string, fields: { state: string; reason?: string | null; jobId?: string | null; at: Date }): Row {
  const at = fields.at.toISOString();
  return db.transaction(() => {
    db.run(`UPDATE mission_bounty_runs SET state=?,reason=?,execution_job_id=COALESCE(?,execution_job_id),
      started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,
      completed_at=CASE WHEN ? IN ('completed','blocked') THEN ? ELSE completed_at END,
      updated_at=? WHERE id=? AND state IN ('assigned','running')`,
      [fields.state, fields.reason ?? null, fields.jobId ?? null, fields.state, at, fields.state, at, at, runId]);
    return db.get<Row>('SELECT * FROM mission_bounty_runs WHERE id=?', [runId])!;
  });
}

async function executeOne(actor: MoneyActor, workflow: GithubBountyWorkflow, run: Row, at: () => Date): Promise<BountyRunOutcome> {
  const runId = String(run.id);
  const assignmentId = String(run.assignment_id);
  try {
    const ready = await workflow.executionReadiness(actor, assignmentId);
    if (!ready.ready) return runOutcome(updateRun(runId, { state: 'blocked', reason: ready.reason, at: at() }));
  } catch {
    return runOutcome(updateRun(runId, { state: 'blocked', reason: 'parallel_execution_failed', at: at() }));
  }
  try {
    const job = workflow.queueExecution(actor, assignmentId);
    updateRun(runId, { state: 'running', jobId: String(job.id), at: at() });
    const result = await workflow.executeJob(actor, String(job.id));
    const state = String(result.state) === 'drafted' ? 'completed' : 'blocked';
    const reason = state === 'completed' ? null : finiteReason(result.blocked_reason);
    return runOutcome(updateRun(runId, { state, reason, jobId: String(job.id), at: at() }));
  } catch {
    return runOutcome(updateRun(runId, { state: 'blocked', reason: 'parallel_execution_failed', at: at() }));
  }
}

/** One scale-safe pass. Discovery/policy are real workflow calls; the executor
 * adds only durable local assignment/run state and read-only execution calls. */
export async function runParallelBountyCycle(actor: MoneyActor, workflow: GithubBountyWorkflow, options: ParallelBountyOptions = {}): Promise<ParallelBountyResult> {
  const maxConcurrency = configuredConcurrency(options.maxConcurrency);
  const leaseMs = Number.isSafeInteger(options.leaseMs) && Number(options.leaseMs) >= 1000 ? Number(options.leaseMs) : DEFAULT_LEASE_MS;
  const clock = options.now ?? (() => new Date());
  const leasesReleased = releaseExpiredBountyRuns(clock());
  const opportunities = await workflow.discover(actor);
  const accepted = opportunities.filter(row => String(row.risk_state) === 'accepted');
  const rejected = opportunities.filter(row => String(row.risk_state) === 'rejected');
  // Scope gate before any policy fetch: only allow-listed repositories proceed.
  const candidates = filterInScopeRepos(
    accepted.filter(row => !db.get('SELECT id FROM mission_bounty_assignments WHERE opportunity_id=?', [String(row.id)])),
    row => String(row.repo_full_name), { agentType: 'github_bounty_parallel' },
  );

  let policyChecked = 0, policyAllowed = 0, policyBanned = 0;
  const policyResults = await mapLimit(candidates, maxConcurrency, async opportunity => {
    const policy = db.get<Row>('SELECT * FROM mission_bounty_policy WHERE repo_full_name=?', [String(opportunity.repo_full_name)]);
    const checkedAt = policy?.checked_at == null ? NaN : Date.parse(String(policy.checked_at));
    if (policy && Number.isFinite(checkedAt) && Date.now() - checkedAt <= 7 * 86400000) {
      return { opportunity, allowed: Number(policy.ai_contributions_allowed) === 1, checked: false, error: false };
    }
    try {
      const checked = await workflow.checkPolicy(actor, String(opportunity.id));
      return { opportunity, allowed: Boolean(checked && Number(checked.ai_contributions_allowed)), checked: true, error: false };
    } catch {
      return { opportunity, allowed: false, checked: true, error: true };
    }
  });
  for (const result of policyResults) {
    if (result.checked) policyChecked++;
    if (result.allowed) policyAllowed++; else if (result.checked && !result.error) policyBanned++;
  }
  const viable = policyResults.filter(result => result.allowed).map(result => result.opportunity);
  const agents = availableAgentRows();
  const assignmentCount = Math.min(viable.length, agents.length, maxConcurrency);
  const runs: Row[] = [];
  for (let index = 0; index < assignmentCount; index += 1) {
    try {
      const assignment = workflow.assign(actor, { agentId: String(agents[index].id), opportunityId: String(viable[index].id) });
      runs.push(newRun(assignment, leaseMs, clock()));
    } catch {
      // A concurrent worker may have won this agent/opportunity. Continue with
      // the remaining deterministic candidates; never duplicate or fabricate.
    }
  }
  const outcomes = await mapLimit(runs, maxConcurrency, run => executeOne(actor, workflow, run, clock));
  const idleIssues = Math.max(0, viable.length - assignmentCount);
  return {
    maxConcurrency, discovered: opportunities.length, accepted: accepted.length, rejected: rejected.length,
    policyChecked, policyAllowed, policyBanned, availableViableIssues: viable.length,
    availableAgents: agents.length, assigned: runs.length, idleIssues,
    // The bounded pass intentionally leaves the remainder idle for the next
    // discovery window; it is not an assignment failure or a fabricated
    // opportunity. Keep the finite reason stable for owner dashboards/tests.
    idleReason: idleIssues ? 'no_viable_opportunity' : null,
    leasesReleased, runs: outcomes,
  };
}

/** Owner-readable evidence. These are database rows, not synthetic status
 * objects; idle capacity is a computed summary over the real rows. */
export function bountyRunsSnapshot() {
  const runs = db.all<Row>('SELECT * FROM mission_bounty_runs ORDER BY created_at DESC,id DESC LIMIT 1000');
  const jobs = db.all<Row>('SELECT id,assignment_id,state,candidate_id,blocked_reason,created_at,updated_at FROM mission_bounty_execution_jobs ORDER BY updated_at DESC LIMIT 1000');
  const agents = db.all<Row>("SELECT id FROM mission_agents WHERE status='active' ORDER BY id");
  const agentStates = agents.map(agent => {
    const run = db.get<Row>('SELECT state,reason,updated_at FROM mission_bounty_runs WHERE agent_id=? ORDER BY updated_at DESC,id DESC LIMIT 1', [String(agent.id)]);
    return run
      ? { agentId: String(agent.id), state: String(run.state), reason: run.reason == null ? null : String(run.reason), updatedAt: String(run.updated_at) }
      : { agentId: String(agent.id), state: 'idle', reason: 'no_viable_opportunity', updatedAt: null };
  });
  return {
    runs,
    executionJobs: jobs,
    agentStates,
    active: runs.filter(row => ['assigned', 'running'].includes(String(row.state))).length,
    completed: runs.filter(row => String(row.state) === 'completed').length,
    blocked: runs.filter(row => String(row.state) === 'blocked').length,
    released: runs.filter(row => String(row.state) === 'released').length,
    note: 'Idle issues are the real discovered viable rows not assigned in the bounded pass; no issue is invented when GitHub evidence or policy is unavailable.',
  };
}
