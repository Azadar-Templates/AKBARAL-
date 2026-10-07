/**
 * Fully autonomous, timer-driven wiring for the GitHub-issue-bounty workflow.
 * Discovery, policy, assignment, and isolated candidate generation are bounded
 * by the scale executor. Passive PR monitoring remains read-only and separate.
 */
import { missionDb as db, nowIso, type Row } from '../database';
import type { MoneyActor } from '../money';
import { GithubBountyWorkflow } from './github-bounty-workflow';
import { runParallelBountyCycle, DEFAULT_BOUNTY_MAX_CONCURRENCY } from './github-bounty-parallel-executor';

const MIN_DISCOVERY_INTERVAL_MS = 10 * 60 * 1000;
const MIN_PR_REVIEW_INTERVAL_MS = 15 * 60 * 1000;
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
  executionAttempted: number;
  executionQueued: number;
  executionVerified: number;
  executionDrafted: number;
  executionBlocked: number;
  executionReason: string | null;
  maxConcurrency: number;
  availableViableIssues: number;
  idleIssues: number;
  leasesReleased: number;
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

export async function runGithubBountyCycle(actor: MoneyActor, workflow: GithubBountyWorkflow): Promise<GithubBountyCycleResult> {
  const empty = {
    discovered: 0, accepted: 0, rejected: 0, policyChecked: 0, policyAllowed: 0, policyBanned: 0, assigned: 0,
    prReviewAttempted: 0, prReviewed: 0, prMerged: 0, prClosedUnmerged: 0, prReviewsApproved: 0,
    prChangesRequested: 0, prChecksPassing: 0, prChecksFailing: 0, prMonitorFailed: 0,
    executionAttempted: 0, executionQueued: 0, executionVerified: 0, executionDrafted: 0, executionBlocked: 0,
    executionReason: null, maxConcurrency: DEFAULT_BOUNTY_MAX_CONCURRENCY, availableViableIssues: 0,
    idleIssues: 0, leasesReleased: 0,
  } as const;
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
    } catch {
      markAttempted('mission_bounty_review_scheduler_state', 'failed:review_cycle_failed');
      prMonitorFailed++;
    }
  }

  let scale = empty;
  if (discoveryDue) {
    markAttempted('mission_bounty_scheduler_state', 'running');
    try {
      const result = await runParallelBountyCycle(actor, workflow);
      const completed = result.runs.filter(run => run.state === 'completed');
      const queued = result.runs.filter(run => run.executionJobId !== null);
      const blocked = result.runs.filter(run => run.state === 'blocked');
      scale = {
        discovered: result.discovered, accepted: result.accepted, rejected: result.rejected,
        policyChecked: result.policyChecked, policyAllowed: result.policyAllowed, policyBanned: result.policyBanned,
        assigned: result.assigned, executionAttempted: completed.length, executionQueued: queued.length,
        executionVerified: completed.length, executionDrafted: completed.length, executionBlocked: blocked.length,
        executionReason: blocked.length ? blocked[0].reason : null, maxConcurrency: result.maxConcurrency,
        availableViableIssues: result.availableViableIssues, idleIssues: result.idleIssues, leasesReleased: result.leasesReleased,
      } as typeof empty;
      markAttempted('mission_bounty_scheduler_state', `completed:assigned=${result.assigned},blocked=${blocked.length}`);
    } catch {
      markAttempted('mission_bounty_scheduler_state', 'failed:parallel_cycle_failed');
    }
  }

  return {
    ran: true,
    ...scale,
    prReviewAttempted, prReviewed, prMerged, prClosedUnmerged, prReviewsApproved, prChangesRequested,
    prChecksPassing, prChecksFailing, prMonitorFailed,
  };
}
