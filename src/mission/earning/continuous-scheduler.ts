/**
 * ZA141251SA CONTINUOUS SCHEDULER — durable operating loop
 * DISCOVER → QUALIFY → SCORE → MATCH → LOCK → EXECUTE → VERIFY → DELIVER
 * → MONITOR PAYMENT → RECONCILE SETTLEMENT → CREDIT WALLET → REINVEST → SCALE → DISCOVER AGAIN
 * Handles retries, expiry, failures, provider outages, rate limits, duplicates, abandoned work safely.
 * No infinite duplicate execution; no fabrication.
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row } from '../database';
import { MoneyError, type MoneyActor } from '../money';
import { currentPolicy } from '../policy';
import * as EarningEngine from './earning-engine';
import * as GlobalDiscovery from './global-discovery';
import * as Allocator from './workload-allocator';
import * as ExecutionPipeline from './execution-pipeline';
import * as ProviderReadiness from './provider-capability-registry';
import * as ResultVerification from './result-verification';
import { configuredGithubBountyWorkflow } from './github-bounty-workflow';
import { runGithubBountyCycle } from './github-bounty-scheduler';



function deny(code: string): never { throw new MoneyError(`scheduler_${code}` as any); }

export interface TickResult {
  cycle: number;
  discovered: number;
  qualified: number;
  matched: number;
  locked: number;
  executing: number;
  verified: number;
  settled: number;
  failed: number;
  retried: number;
  expired: number;
  rateLimited: number;
  reinvested: number;
  scaled: number;
  /** GitHub-issue-bounty sweep, self-paced (at most once per ~10min regardless
   * of tick frequency). 0/undefined when the cycle wasn't due this tick. */
  bountyDiscovered: number;
  bountyRejected: number;
  bountyPolicyAllowed: number;
  bountyAssigned: number;
  /** Read-only GitHub evidence for PRs already submitted by the workflow. */
  bountyPrReviewed: number;
  bountyPrMerged: number;
  bountyPrClosedUnmerged: number;
  bountyChecksPassing: number;
  bountyChecksFailing: number;
  /** Executing opportunities with no recorded output yet: real work in flight,
   *  not verified, and never counted as completed. */
  awaitingEvidence: number;
  /** Isolated bounty source/test execution, not a PR or settlement count. */
  bountyExecutionAttempted: number;
  bountyExecutionDrafted: number;
  bountyExecutionBlocked: number;
  detail: string;
}

let tickRunning = false;

function ensureSchedulerRow(): Row {
  let row = db.get<Row>('SELECT * FROM mission_scheduler_state WHERE id=\'global\'');
  if (!row) {
    db.run('INSERT OR IGNORE INTO mission_scheduler_state (id, enabled, last_tick_at, last_cycle, consecutive_failures, last_error, updated_at) VALUES (\'global\',0,NULL,0,0,NULL,?)', [nowIso()]);
    row = db.get<Row>('SELECT * FROM mission_scheduler_state WHERE id=\'global\'')!;
  }
  return row!;
}

export function schedulerStatus(): Row & { tickRunning: boolean } {
  const row = ensureSchedulerRow();
  return { ...row, tickRunning } as any;
}

export function enableScheduler(actor: MoneyActor): Row {
  if (currentPolicy().killSwitch) deny('kill_switch_engaged');
  db.run('UPDATE mission_scheduler_state SET enabled=1, updated_at=? WHERE id=\'global\'', [nowIso()]);
  appendMissionAudit({ actorType: actor.kind as any, actorId: actor.id, action: 'scheduler.enabled', subjectType:'mission', subjectId:'global' });
  return schedulerStatus() as any;
}
export function disableScheduler(actor: MoneyActor): Row {
  db.run('UPDATE mission_scheduler_state SET enabled=0, updated_at=? WHERE id=\'global\'', [nowIso()]);
  appendMissionAudit({ actorType: actor.kind as any, actorId: actor.id, action: 'scheduler.disabled', subjectType:'mission', subjectId:'global' });
  return schedulerStatus() as any;
}

/** One durable tick: never fabricates work; if no permitted opportunity, it discovers more. */
export async function tickScheduler(actor: MoneyActor): Promise<TickResult> {
  if (tickRunning) deny('tick_already_running');
  const policy = currentPolicy();
  if (policy.killSwitch) {
    db.run('UPDATE mission_scheduler_state SET consecutive_failures=consecutive_failures+1, last_error=?, updated_at=? WHERE id=\'global\'', ['kill_switch_engaged', nowIso()]);
    deny('kill_switch_engaged');
  }
  tickRunning = true;
  const state = ensureSchedulerRow();
  const cycle = Number(state.last_cycle ?? 0) + 1;
  const tickId = missionId('tick');
  const startedAt = nowIso();
  // Idempotent tick insert — if cycle already exists (concurrent tick), skip
  const inserted = db.run('INSERT OR IGNORE INTO mission_scheduler_ticks (id, cycle, started_at, status, discovered, qualified, matched, locked, executing, verified, settled, failed, retried, expired, rate_limited) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [tickId, cycle, startedAt, 'running', 0,0,0,0,0,0,0,0,0,0,0]);
  if (inserted.changes === 0) {
    tickRunning = false;
    deny('tick_cycle_already_exists');
  }

  let discovered = 0, qualified = 0, matched = 0, locked = 0, executing = 0, verified = 0, settled = 0, failed = 0, retried = 0, expired = 0, rateLimited = 0, reinvested = 0, scaled = 0;
  let awaitingEvidence = 0;
  let bountyDiscovered = 0, bountyRejected = 0, bountyPolicyAllowed = 0, bountyAssigned = 0;
  let bountyPrReviewed = 0, bountyPrMerged = 0, bountyPrClosedUnmerged = 0, bountyChecksPassing = 0, bountyChecksFailing = 0;
  let bountyExecutionAttempted = 0, bountyExecutionDrafted = 0, bountyExecutionBlocked = 0;
  let detail = '';
  try {
    // ── 1. DISCOVER: global beyond-57 sweep + qualify
    try {
      const disc = GlobalDiscovery.runGlobalDiscoveryCycle(actor, 6);
      discovered = disc.opportunities.length;
      // Count platforms that moved to QUALIFIED
      qualified = disc.platforms.filter(p=> {
        try { const cur = db.get<Row>('SELECT status FROM mission_platforms WHERE id=?',[String(p.id)]); return String(cur?.status)==='QUALIFIED'; } catch { return false; }
      }).length;
    } catch (e) {
      const msg = String((e as any)?.code ?? (e as any)?.message ?? '');
      if (/rate_limited/i.test(msg)) rateLimited++;
      // provider outage → retried count
      if (/provider|timeout|outage/i.test(msg)) retried++;
      throw e;
    }

    // ── 1b. GitHub-issue-bounty sweep: discover → auto-reject fraud/bait leads →
    // policy-check → assign. Fully autonomous, self-paced; never depends on a
    // human/owner calling the HTTP API. Never fatal to the rest of the tick.
    try {
      const bounty = await runGithubBountyCycle(actor, configuredGithubBountyWorkflow());
      bountyDiscovered = bounty.discovered;
      bountyRejected = bounty.rejected;
      bountyPolicyAllowed = bounty.policyAllowed;
      bountyAssigned = bounty.assigned;
      bountyPrReviewed = bounty.prReviewed;
      bountyPrMerged = bounty.prMerged;
      bountyPrClosedUnmerged = bounty.prClosedUnmerged;
      bountyChecksPassing = bounty.prChecksPassing;
      bountyChecksFailing = bounty.prChecksFailing;
      bountyExecutionAttempted = bounty.executionAttempted;
      bountyExecutionDrafted = bounty.executionDrafted;
      bountyExecutionBlocked = bounty.executionBlocked;
    } catch (e) {
      const msg = String((e as any)?.code ?? (e as any)?.message ?? '');
      if (/rate_limited/i.test(msg)) rateLimited++;
      // never rethrown — a bounty-sweep failure must never abort the rest of the tick
    }

    // ── 2. Expiry sweep: mark expired opportunities
    const nowMs = Date.now();
    const expiring = db.all<Row>('SELECT id FROM mission_earning_engine_opportunities WHERE verification_state IN (\'discovered\',\'qualified\')');
    for (const r of expiring) {
      const opp = EarningEngine.getEngineOpportunity(String(r.id));
      if (!opp) continue;
      const expiry = Date.parse(String(opp.opportunity_expiry));
      if (Number.isFinite(expiry) && expiry <= nowMs) {
        try { EarningEngine.recordFailure(String(opp.id), 'opportunity_expired'); expired++; } catch {}
      }
    }

    // ── 3. Abandoned work: unlock stale locks (>2h) with CAS audit + retry
    const abandoned = db.all<Row>('SELECT id, locked_at, version FROM mission_earning_engine_opportunities WHERE verification_state IN (\'assigned\',\'executing\') AND locked_at IS NOT NULL');
    for (const r of abandoned) {
      const lockedAt = Date.parse(String((r as any).locked_at));
      if (Number.isFinite(lockedAt) && nowMs - lockedAt > 2*3600*1000) {
        try {
          const ver = Number((r as any).version ?? 0);
          const changes = db.run('UPDATE mission_earning_engine_opportunities SET locked_by=NULL, locked_at=NULL, verification_state=\'qualified\', updated_at=?, version=version+1 WHERE id=? AND version=?', [nowIso(), String(r.id), ver]);
          if (changes.changes>0) {
            appendMissionAudit({actorType:'system', action:'scheduler.abandoned_unlocked', subjectType:'earning_opportunity', subjectId: String(r.id), detail:{lockedAt: String((r as any).locked_at)}});
            retried++;
          }
        } catch {}
      }
    }
    // ── 3b. Retry-due executions (exponential backoff, durable)
    try { const due = ExecutionPipeline.retryDueExecutions(5); if (due.length) retried += due.length; } catch {}

    // ── 4. MATCH → LOCK → EXECUTE for top pending opportunities (allocator + execution pipeline with durable idempotency + human gate)
    // Elastic admission: every eligible opportunity this cycle may admit is walked,
    // not a fixed 5. The safety gates (kill switch, eligibility, provider readiness,
    // exclusive per-opportunity lock, spend caps) are all inside allocateBestAgent and
    // the pipeline, so scale is bounded by real constraints instead of a hard-coded lid.
    const batch = Allocator.allocateBatch();
    for (const { opportunity: opp, agent } of batch) {
      if (!agent) continue;
      const oppId = String(opp.id);
      let agentId = String((agent as any).id);
      if (agentId.startsWith('virtual-')) {
        const real = Allocator.materializeVirtualAgent(agentId);
        if (!real) continue;
        agentId = String(real.id);
      }
      // Durable execution via pipeline (idempotent, gated on human/ToS/credentials)
      try {
        const connectorHint = String(opp.platform ?? '').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40) || String(opp.registry_key ?? '').toLowerCase();
        // Prefer pipeline which does lock+schedule+execution row creation with eligibility + readiness checks
        try {
          EarningEngine.lockOpportunityExclusive(oppId, agentId);
          locked++; matched++;
        } catch (e) {
          const code = String((e as any)?.code ?? (e as any)?.message ?? '');
          if (/already_locked|already_assigned|duplicate/i.test(code)) { continue; }
          if (/rate_limited/i.test(code)) {
            rateLimited++;
            try {
              const conn = String(opp.platform ?? 'generic');
              ProviderReadiness.recordProviderFailure(conn.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40), {code: code.slice(0,120), category:'rate_limit', detail: `scheduler tick ${cycle} rate-limited on ${oppId}`});
            } catch {}
            continue;
          }
          continue;
        }
        try {
          EarningEngine.scheduleWork(oppId, agentId);
          executing++;
        } catch (e) {
          const code = String((e as any)?.code ?? '');
          if (/kill_switch/i.test(code)) throw e;
        }
        // Durably record execution for retry/backoff/audit (idempotent)
        try {
          ExecutionPipeline.startExecution({opportunityId: oppId, agentId, connectorId: connectorHint});
          // If startExecution succeeded but opportunity already executing, it returns existing row
        } catch (pe) {
          const pcode = String((pe as any)?.code ?? (pe as any)?.message ?? '');
          if (/human_only|provider_blocked|provider_not_configured/i.test(pcode)) {
            // Human-required: leave as assigned but do not count as executing; scheduler will surface as blocked
            continue;
          }
          if (/spending_denied/i.test(pcode)) {
            retried++;
            continue;
          }
        }
      } catch { continue; }
    }

    // ── 5. VERIFY → MONITOR PAYMENT → RECONCILE
    // Verification is evidence-gated (result-verification.ts), and payment/settlement remain
    // owner/provider gates: this loop advances nothing it cannot point at bytes for.
    // THIS BLOCK USED TO FABRICATE COMPLETION. It called verifyWorkMultiAgent with
    // {producer: 0.92 passed:true} plus "any other active agent" at 0.88 passed:true —
    // no artifact, no digest, no independent reviewer — which flipped opportunities to
    // `verified` and fed mission_opportunity_roi, reinvestment and class scaling with a
    // made-up success record. Verification is now derived from durable evidence: an
    // opportunity with no recorded output stays `executing` and is reported as awaiting
    // evidence, never counted as completed work.
    const verification = ResultVerification.autonomousVerifyExecuting(Math.min(25, Math.max(3, Allocator.admissionCeiling().cycleLimit || 3)));
    verified += verification.verified;
    awaitingEvidence = verification.awaitingEvidence;
    retried += verification.failed;

    // Note: provider payment + settlement are HUMAN/PROVIDER gates — scheduler does NOT simulate them.
    // It only counts already settled in this tick for metrics.
    const newlySettled = db.all<Row>('SELECT id FROM mission_earning_engine_opportunities WHERE verification_state=\'settlement_verified\' AND updated_at >= ?', [startedAt]);
    settled = newlySettled.length;

    // ── 6. REINVEST + SCALE (only on genuine verified net)
    const totalVerified = EarningEngine.totalVerifiedEarnings();
    if (totalVerified > 0) {
      const reinvest = EarningEngine.reinvestmentDecision(totalVerified);
      if (reinvest.eligible) reinvested = reinvest.reinvestCents;
      // Bounded scaling: try to scale winning classes where ROI positive
      const rois = EarningEngine.listROI().filter(r=> Number(r.successes)>0 && Number(r.total_net_cents)>0).slice(0,2);
      for (const roi of rois) {
        const parent = db.get<Row>('SELECT id FROM mission_agents WHERE status=\'active\' LIMIT 1');
        if (!parent) continue;
        const res: any = EarningEngine.scaleWinningClass(String(roi.registry_key), String(roi.registry_key), String(parent.id), `Scale-${roi.registry_key}`);
        if (!res.skipped) scaled++;
      }
    }

    // ── 7. Failure learning: NOT IMPLEMENTED. The previous form of this block
    // was an `if` with an empty body (a no-op) whose condition compared an
    // `unknown` from allocatorStatus() against 0, which failed typecheck.
    // Nothing was recorded then and nothing is recorded now; the counters in
    // `detail` below remain the honest per-cycle record.

    detail = `cycle ${cycle}: disc ${discovered} qual ${qualified} match ${matched} lock ${locked} exec ${executing} verify ${verified} awaiting-evidence ${awaitingEvidence} settle ${settled} fail ${failed} retry ${retried} expire ${expired} bounty(disc ${bountyDiscovered} rej ${bountyRejected} allow ${bountyPolicyAllowed} assign ${bountyAssigned} pr-review ${bountyPrReviewed} merge ${bountyPrMerged} closed ${bountyPrClosedUnmerged} checks-pass ${bountyChecksPassing} checks-fail ${bountyChecksFailing} exec-attempt ${bountyExecutionAttempted} exec-drafted ${bountyExecutionDrafted} exec-blocked ${bountyExecutionBlocked})`;
    db.run('UPDATE mission_scheduler_ticks SET completed_at=?, discovered=?, qualified=?, matched=?, locked=?, executing=?, verified=?, settled=?, failed=?, retried=?, expired=?, rate_limited=?, detail=?, status=\'completed\' WHERE id=?',
      [nowIso(), discovered, qualified, matched, locked, executing, verified, settled, failed, retried, expired, rateLimited, detail, tickId]);
    db.run('UPDATE mission_scheduler_state SET last_tick_at=?, last_cycle=?, consecutive_failures=0, last_error=NULL, updated_at=? WHERE id=\'global\'', [nowIso(), cycle, nowIso()]);
    // Earning intelligence snapshot
    try {
      const rois = EarningEngine.listROI();
      for (const roi of rois) {
        db.run('INSERT INTO mission_earning_intelligence (id, cycle, registry_key, attempts, completed, verified_payments, gross_cents, fees_cents, net_cents, avg_score, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [missionId('intel'), cycle, String(roi.registry_key), Number(roi.attempts), Number(roi.successes), Number(roi.successes), Number(roi.total_gross_cents), Number(roi.total_fees_cents), Number(roi.total_net_cents), Number(roi.avg_score ?? 0), nowIso()]);
      }
    } catch {}
    return { cycle, discovered, qualified, matched, locked, executing, verified, settled, failed, retried, expired, rateLimited, reinvested, scaled, awaitingEvidence, bountyDiscovered, bountyRejected, bountyPolicyAllowed, bountyAssigned, bountyPrReviewed, bountyPrMerged, bountyPrClosedUnmerged, bountyChecksPassing, bountyChecksFailing, bountyExecutionAttempted, bountyExecutionDrafted, bountyExecutionBlocked, detail };
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);
    failed++;
    db.run('UPDATE mission_scheduler_ticks SET completed_at=?, discovered=?, qualified=?, matched=?, locked=?, executing=?, verified=?, settled=?, failed=?, retried=?, expired=?, rate_limited=?, detail=?, status=\'failed\' WHERE id=?',
      [nowIso(), discovered, qualified, matched, locked, executing, verified, settled, failed, retried, expired, rateLimited, `failed: ${msg.slice(0,500)}`, tickId]);
    db.run('UPDATE mission_scheduler_state SET consecutive_failures=consecutive_failures+1, last_error=?, updated_at=? WHERE id=\'global\'', [msg.slice(0,500), nowIso()]);
    detail = `failed: ${msg.slice(0,500)}`;
    return { cycle, discovered, qualified, matched, locked, executing, verified, settled, failed, retried, expired, rateLimited, reinvested, scaled, awaitingEvidence, bountyDiscovered, bountyRejected, bountyPolicyAllowed, bountyAssigned, bountyPrReviewed, bountyPrMerged, bountyPrClosedUnmerged, bountyChecksPassing, bountyChecksFailing, bountyExecutionAttempted, bountyExecutionDrafted, bountyExecutionBlocked, detail };
  } finally {
    tickRunning = false;
  }
}


export function listSchedulerTicks(limit=20): Row[] {
  return db.all<Row>('SELECT * FROM mission_scheduler_ticks ORDER BY cycle DESC LIMIT ?', [limit]);
}

/** Auto-loop for production: runs tickScheduler every intervalMs while enabled */
let intervalHandle: NodeJS.Timeout | null = null;
export function startAutoScheduler(actor: MoneyActor, intervalMs= 60_000): void {
  if (intervalHandle) return;
  enableScheduler(actor);
  intervalHandle = setInterval(()=> {
    tickScheduler(actor).catch(() => {});
  }, Math.max(5000, intervalMs));
  // Do not keep process alive just for this interval
  if (intervalHandle && typeof (intervalHandle as any).unref === 'function') (intervalHandle as any).unref();
}
export function stopAutoScheduler(actor: MoneyActor): void {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  disableScheduler(actor);
}
