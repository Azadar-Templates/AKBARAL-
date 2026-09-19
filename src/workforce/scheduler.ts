import { createHash } from 'node:crypto';
import { searchWeb } from '../agents/web-research';
import {
  getEconomyPolicy, insertOpportunity, listAgentProfiles, listExecutions, listOpportunities,
  recordEconomyEvent,
} from '../db/economy-repositories';
import { currentPolicy } from '../economy/policy';
import { evaluateOpportunity, reconcileStaleExecutions, startExecution } from '../economy/operations';
import { proposeSettlement } from '../economy/treasury';
import { getAgentOverlay, isSourceUsable, sourceKeyFor } from './repositories';
import { WORKFORCE_CATEGORIES } from './categories';
import { runWorkforceExecution } from './execution';

/**
 * WORKFORCE SCHEDULER — continuous operation across ALL earning categories.
 *
 * Each tick (crash-safe, idempotent, DB-backed):
 *   1. Reconcile stale executions (bounded retry, honest terminal failure).
 *   2. Discover opportunities across workforce categories (risk protection:
 *      blocked/unusable sources are skipped, never retried blindly).
 *   3. Evaluate + auto-authorize what clears the owner's thresholds, matched
 *      to a multi-category-eligible agent.
 *   4. Run due executions through the real workforce pipeline.
 *   5. Propose owner settlement above the operating float (never transfers —
 *      the payout path needs the owner + a verified destination).
 *
 * Idle unless the owner enables autonomous operation. The kill switch halts
 * everything. Nothing here can fabricate revenue, skip approvals, or contact
 * anyone.
 */

const TICK_MS = 60_000;
const DISCOVERY_EVERY_TICKS = 10; // ~10 minutes between discovery sweeps

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

export interface WorkforceTickResult {
  acted: boolean;
  notes: string[];
}

export async function workforceDiscovery(categoryKeys?: string[]): Promise<{ searched: string[]; discovered: number; duplicates: number; skippedBlocked: number; unavailable?: string }> {
  const policy = currentPolicy();
  const wanted = new Set(
    categoryKeys && categoryKeys.length > 0
      ? categoryKeys
      : policy.discoveryCategories.length > 0
        ? policy.discoveryCategories
        : WORKFORCE_CATEGORIES.map((c) => c.key),
  );
  const categories = WORKFORCE_CATEGORIES.filter((c) => wanted.has(c.key));
  let discovered = 0;
  let duplicates = 0;
  let skippedBlocked = 0;
  const searched: string[] = [];
  for (const category of categories) {
    for (const query of category.queries.slice(0, 1)) {
      let results: Awaited<ReturnType<typeof searchWeb>>;
      try {
        results = await searchWeb(query, 5);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordEconomyEvent({ kind: 'discovery', summary: `workforce discovery unavailable for '${category.key}': ${message}`, details: { query } });
        return { searched, discovered, duplicates, skippedBlocked, unavailable: message };
      }
      searched.push(category.key);
      for (const result of results) {
        if (!result.url || !result.title) continue;
        // Risk protection: never re-discover from a blocked/unusable source.
        if (!isSourceUsable(sourceKeyFor(domainOf(result.url), category.key))) {
          skippedBlocked += 1;
          continue;
        }
        const inserted = insertOpportunity({
          sourceUrlHash: sha256(result.url),
          sourceUrl: result.url,
          category: category.key,
          title: result.title.slice(0, 300),
          summary: (result.description || '').slice(0, 2000),
          expectedRevenueCents: category.defaultRevenueCents,
          expectedCostCents: category.defaultCostCents,
          timeHours: category.defaultTimeHours,
          riskLevel: category.defaultRisk,
          probability: category.defaultProbability,
          estimateBasis: 'workforce_category_default_market_rate_estimate',
        });
        if (inserted.duplicate) duplicates += 1;
        else {
          discovered += 1;
          recordEconomyEvent({
            kind: 'discovery',
            summary: `workforce opportunity [${category.key}]: ${result.title.slice(0, 120)}`,
            details: { url: result.url, estimateBasis: 'workforce_category_default_market_rate_estimate' },
          });
        }
      }
    }
  }
  return { searched, discovered, duplicates, skippedBlocked };
}

/**
 * Multi-category agent matching: prefer an active workforce agent whose
 * overlay lists the opportunity's category; fall back to any active profile,
 * then to the flagship research agent. Registry is read-only.
 */
export function pickWorkforceAgent(category: string): string {
  const profiles = listAgentProfiles().filter((p) => p.status === 'active');
  for (const profile of profiles) {
    try {
      if (getAgentOverlay(profile.agent_slug).categories.includes(category)) return profile.agent_slug;
    } catch { /* overlay table may predate migration in old test DBs */ }
  }
  if (profiles[0]) return profiles[0].agent_slug;
  return 'web-research-001';
}

export class WorkforceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private running = false;
  private lastDiscoveryTick = -Infinity;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<WorkforceTickResult> {
    if (this.running) return { acted: false, notes: ['tick_skipped_busy'] };
    this.running = true;
    this.tickCount += 1;
    const notes: string[] = [];
    try {
      reconcileStaleExecutions();
      const policy = currentPolicy();
      if (policy.killSwitch) {
        notes.push('kill_switch_engaged');
        return { acted: false, notes };
      }
      const row = getEconomyPolicy();
      void row;
      if (!policy.autonomousEnabled) {
        notes.push('autonomous_operation_disabled (scheduler idle; recovery still runs)');
        return { acted: false, notes };
      }
      if (policy.discoveryEnabled && this.tickCount - this.lastDiscoveryTick >= DISCOVERY_EVERY_TICKS) {
        this.lastDiscoveryTick = this.tickCount;
        try {
          const discovery = await workforceDiscovery();
          notes.push(`discovery: +${discovery.discovered} new, ${discovery.duplicates} duplicates, ${discovery.skippedBlocked} skipped (blocked sources)${discovery.unavailable ? `, unavailable: ${discovery.unavailable}` : ''}`);
        } catch (error) {
          notes.push(`discovery failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const pending = listOpportunities('discovered', 25);
      let authorized = 0;
      for (const opportunity of pending) {
        const evaluation = evaluateOpportunity(opportunity.id, policy);
        if (evaluation.authorized) {
          const start = startExecution({ opportunityId: opportunity.id, agentSlug: pickWorkforceAgent(opportunity.category), authorizedBy: 'policy' });
          if (start.created) authorized += 1;
        }
      }
      if (authorized > 0) notes.push(`auto-authorized ${authorized} opportunity(ies)`);
      const due = listExecutions('authorized', policy.maxConcurrentExecutions);
      for (const execution of due) {
        if (currentPolicy().killSwitch) break;
        await runWorkforceExecution(execution.id);
      }
      if (due.length > 0) notes.push(`ran ${due.length} workforce execution(s)`);
      const settlement = proposeSettlement();
      if (settlement.created) notes.push(`settlement proposed: ${settlement.amountCents}c`);
      return { acted: notes.length > 0, notes };
    } finally {
      this.running = false;
    }
  }
}

export const workforceScheduler = new WorkforceScheduler();
