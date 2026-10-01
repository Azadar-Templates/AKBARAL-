/**
 * Fully autonomous, timer-driven wiring for the GitHub-issue-bounty workflow.
 *
 * Discovery/policy/assignment self-pace independently from passive PR review
 * monitoring. Both paths are bounded, read their evidence directly from
 * GitHub, and need no owner request per cycle. The monitor never creates a
 * PR, posts a review, or interprets a merge as cash.
 */
import { missionDb as db, nowIso, type Row } from '../database';
import type { MoneyActor } from '../money';
import { GithubBountyWorkflow } from './github-bounty-workflow';

const MIN_DISCOVERY_INTERVAL_MS = 10 * 60 * 1000;
// One reviewed PR consumes three read-only API calls (PR, reviews, checks).
// At this interval, in addition to the bounded discovery sweep, an anonymous
// client remains below GitHub's public core API quota in normal operation.
const MIN_PR_REVIEW_INTERVAL_MS = 15 * 60 * 1000;
const MAX_POLICY_CHECKS_PER_CYCLE = 5;
const MAX_ASSIGNMENTS_PER_CYCLE = 3;
const MAX_PULL_REQUESTS_PER_REVIEW_CYCLE = 1;

export interface GithubBountyCycleResult {
  ran: boolean;
  reason?: string;
  discovered: number;
  accepted: number;
  rejected: number;
  policyChecked: number;
  policyAllowed: number;
  policyBanned: number;
  assigned: number;
  prReviewAttempted: number;
  prReviewed: number;
  prMerged: number;
  prClosedUnmerged: number;
  prReviewsApproved: number;
  prChangesRequested: number;
  prChecksPassing: number;
  prChecksFailing: number;
  prMonitorFailed: number;
  /** Isolated source/solution/test pipeline; no PR is submitted here. */
  executionAttempted: number;
  executionQueued: number;
  executionVerified: number;
  executionDrafted: number;
  executionBlocked: number;
  /** Safe finite reason from the execution-cycle readiness/state machine. */
  executionReason: string | null;
}

function isDue(table: string, intervalMs: number): boolean {
  const row = db.get<Row>(`SELECT last_attempted_at FROM ${table} WHERE id='global'`);
  if (!row || !row.last_attempted_at) return true;
  const last = Date.parse(String(row.last_attempted_at));
  return !Number.isFinite(last) || Date.now() - last > intervalMs;
}
function markAttempted(table: string, result: string) {
  db.run(`INSERT INTO ${table} (id,last_attempted_at,last_result) VALUES ('global',?,?)
    ON CONFLICT(id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at, last_result=excluded.last_result`, [nowIso(), result]);
}

/** One durable, self-paced pass.
 *
 * - Submitted PR review/check/merge status is refreshed first, at most one PR
 *   every fifteen minutes. This reserves enough request budget for discovery.
 * - Discovery remains at most once per ten minutes, then applies bounded
 *   policy checks and assignments.
 * - All transient failures are recorded and retried later; no status is
 *   inferred from a failed request. */
export async function runGithubBountyCycle(actor: MoneyActor, workflow: GithubBountyWorkflow): Promise<GithubBountyCycleResult> {
  const empty = {
    discovered: 0, accepted: 0, rejected: 0, policyChecked: 0, policyAllowed: 0, policyBanned: 0, assigned: 0,
    prReviewAttempted: 0, prReviewed: 0, prMerged: 0, prClosedUnmerged: 0, prReviewsApproved: 0,
    prChangesRequested: 0, prChecksPassing: 0, prChecksFailing: 0, prMonitorFailed: 0,
    executionAttempted: 0, executionQueued: 0, executionVerified: 0, executionDrafted: 0, executionBlocked: 0, executionReason: null,
  };
  const reviewDue = isDue('mission_bounty_review_scheduler_state', MIN_PR_REVIEW_INTERVAL_MS);
  const discoveryDue = isDue('mission_bounty_scheduler_state', MIN_DISCOVERY_INTERVAL_MS);
  if (!reviewDue && !discoveryDue) return { ran: false, reason: 'not_due', ...empty };

  let prReviewAttempted = 0, prReviewed = 0, prMerged = 0, prClosedUnmerged = 0, prReviewsApproved = 0, prChangesRequested = 0, prChecksPassing = 0, prChecksFailing = 0, prMonitorFailed = 0;
  if (reviewDue) {
    markAttempted('mission_bounty_review_scheduler_state', 'running');
    try {
      const monitored = await workflow.refreshSubmittedPullRequests(actor, MAX_PULL_REQUESTS_PER_REVIEW_CYCLE);
      ({ attempted: prReviewAttempted, observed: prReviewed, merged: prMerged, closedUnmerged: prClosedUnmerged, reviewsApproved: prReviewsApproved, changesRequested: prChangesRequested, checksPassing: prChecksPassing, checksFailing: prChecksFailing, failed: prMonitorFailed } = monitored);
      markAttempted('mission_bounty_review_scheduler_state', `completed:observed=${prReviewed},failed=${prMonitorFailed}`);
    } catch (error) {
      markAttempted('mission_bounty_review_scheduler_state', `failed:${String((error as Error)?.message ?? error).slice(0, 200)}`);
      prMonitorFailed++;
    }
  }

  let discovered = 0, accepted = 0, rejected = 0, policyChecked = 0, policyAllowed = 0, policyBanned = 0, assigned = 0;
  if (discoveryDue) {
    markAttempted('mission_bounty_scheduler_state', 'running');
    try {
      const opportunities = await workflow.discover(actor);
      discovered = opportunities.length;
      accepted = opportunities.filter(o => String(o.risk_state) === 'accepted').length;
      rejected = opportunities.filter(o => String(o.risk_state) === 'rejected').length;

      const unchecked = db.all<Row>(
        `SELECT o.id FROM mission_bounty_opportunities o
         LEFT JOIN mission_bounty_policy p ON p.repo_full_name = o.repo_full_name
         WHERE o.risk_state='accepted' AND p.repo_full_name IS NULL
         ORDER BY o.observed_at DESC LIMIT ?`, [MAX_POLICY_CHECKS_PER_CYCLE]);
      for (const o of unchecked) {
        try {
          const policy = await workflow.checkPolicy(actor, String(o.id));
          policyChecked++;
          if (policy && Number(policy.ai_contributions_allowed)) policyAllowed++; else policyBanned++;
        } catch { /* rate-limited/transient — retried automatically on a later cycle */ }
      }

      const assignable = db.all<Row>(
        `SELECT o.id FROM mission_bounty_opportunities o
         JOIN mission_bounty_policy p ON p.repo_full_name = o.repo_full_name AND p.ai_contributions_allowed=1
         LEFT JOIN mission_bounty_assignments a ON a.opportunity_id = o.id
         WHERE o.risk_state='accepted' AND a.id IS NULL
         ORDER BY o.observed_at DESC LIMIT ?`, [MAX_ASSIGNMENTS_PER_CYCLE]);
      for (const o of assignable) {
        const agentRow = db.get<Row>(
          `SELECT ag.id FROM mission_agents ag
           WHERE ag.status='active'
             AND NOT EXISTS (SELECT 1 FROM mission_bounty_assignments a2 WHERE a2.agent_id = ag.id AND a2.state='eligible')
           ORDER BY ag.id LIMIT 1`);
        if (!agentRow) break; // no available agent this cycle — nothing to allocate to, not an error
        try { workflow.assign(actor, { agentId: String(agentRow.id), opportunityId: String(o.id) }); assigned++; }
        catch { /* e.g. no active money grant configured yet — honest skip, never fabricated */ }
      }
      markAttempted('mission_bounty_scheduler_state', 'completed');
    } catch (error) {
      markAttempted('mission_bounty_scheduler_state', `failed:${String((error as Error)?.message ?? error).slice(0, 200)}`);
    }
  }

  // Execution is intentionally after discovery/assignment and at most one job.
  // runExecutionCycle itself performs no provider/archive action unless both a
  // digest-pinned sandbox and authorized, metered model resource are ready.
  let executionAttempted = 0, executionQueued = 0, executionVerified = 0, executionDrafted = 0, executionBlocked = 0, executionReason: string | null = null;
  try {
    const execution = await workflow.runExecutionCycle(actor);
    executionAttempted = execution.attempted ? 1 : 0;
    executionQueued = execution.queued ? 1 : 0;
    executionVerified = execution.state === 'verified' || execution.state === 'drafted' ? 1 : 0;
    executionDrafted = execution.state === 'drafted' ? 1 : 0;
    executionBlocked = execution.state === 'blocked' ? 1 : 0;
    executionReason = execution.reason;
  } catch { executionReason = 'execution_scheduler_failed'; /* execution is isolated from discovery; durable job state/audit tells the truth */ }

  return { ran: true, discovered, accepted, rejected, policyChecked, policyAllowed, policyBanned, assigned, prReviewAttempted, prReviewed, prMerged, prClosedUnmerged, prReviewsApproved, prChangesRequested, prChecksPassing, prChecksFailing, prMonitorFailed, executionAttempted, executionQueued, executionVerified, executionDrafted, executionBlocked, executionReason };
}
