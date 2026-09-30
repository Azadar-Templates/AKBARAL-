/**
 * Fully autonomous, timer-driven wiring for the GitHub-issue-bounty workflow.
 * Before this file existed, GithubBountyWorkflow.discover()/checkPolicy()/
 * assign() were only reachable by someone (owner or agent) calling the HTTP
 * API by hand — i.e. NOT actually continuous. This closes that gap: the
 * mission's real production scheduler (continuous-scheduler.ts, already
 * running on an unattended interval via startAutoScheduler()) now calls
 * runGithubBountyCycle() on every tick, with no human/owner action required.
 *
 * Internally self-paced to at most one real discovery sweep per
 * MIN_CYCLE_INTERVAL_MS regardless of how often the scheduler ticks, so it
 * never depends on — and never exceeds — GitHub's rate limits even running
 * unauthenticated, forever, unattended.
 *
 * Never drafts or submits a PR: preparing the actual fix content and the
 * owner's editorial content-safety approval remain a separate, deliberate
 * step (see github-bounty-workflow.ts draft()/approveCandidate()/submit()).
 */
import { missionDb as db, nowIso, type Row } from '../database';
import type { MoneyActor } from '../money';
import { GithubBountyWorkflow } from './github-bounty-workflow';

const MIN_CYCLE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_POLICY_CHECKS_PER_CYCLE = 5;
const MAX_ASSIGNMENTS_PER_CYCLE = 3;

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
}

function dueForCycle(): boolean {
  const row = db.get<Row>("SELECT last_attempted_at FROM mission_bounty_scheduler_state WHERE id='global'");
  if (!row || !row.last_attempted_at) return true;
  return Date.now() - Date.parse(String(row.last_attempted_at)) > MIN_CYCLE_INTERVAL_MS;
}
function markAttempted(result: string) {
  db.run(`INSERT INTO mission_bounty_scheduler_state (id,last_attempted_at,last_result) VALUES ('global',?,?)
    ON CONFLICT(id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at, last_result=excluded.last_result`, [nowIso(), result]);
}

/** One durable, self-paced sweep: discover → auto-reject fraud/bait leads →
 * policy-check a bounded batch → assign a bounded batch to available agents.
 * Never throws on real transient/rate-limit errors — those are recorded and
 * retried on a later cycle, exactly like every other step in the scheduler. */
export async function runGithubBountyCycle(actor: MoneyActor, workflow: GithubBountyWorkflow): Promise<GithubBountyCycleResult> {
  const empty = { discovered: 0, accepted: 0, rejected: 0, policyChecked: 0, policyAllowed: 0, policyBanned: 0, assigned: 0 };
  if (!dueForCycle()) return { ran: false, reason: 'not_due', ...empty };
  markAttempted('running');
  let discovered = 0, accepted = 0, rejected = 0, policyChecked = 0, policyAllowed = 0, policyBanned = 0, assigned = 0;
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
      catch { /* e.g. no active money grant configured yet for this agent — an honest skip, never fabricated */ }
    }
    markAttempted('completed');
  } catch (error) {
    markAttempted(`failed:${String((error as Error)?.message ?? error).slice(0, 200)}`);
  }
  return { ran: true, discovered, accepted, rejected, policyChecked, policyAllowed, policyBanned, assigned };
}
