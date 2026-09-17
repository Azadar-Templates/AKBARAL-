/**
 * Operator seed for an owner-assigned work item in the private economy.
 *
 * The autonomous discovery path needs an outbound web-search provider; when the
 * operator assigns work directly (the owner decides what the mission should do
 * next) the item still has to exist in the real opportunity table so that
 * evaluation, policy authorisation, dispatch, verification and accounting all
 * run through the production pipeline. This script writes exactly that row with
 * the production repository function — no test doubles, no fabricated numbers:
 * revenue/cost estimates are the operator's own stated figures and the
 * provenance field says the item was assigned by the owner.
 *
 *   DATABASE_URL=file:./platform-live.db npx tsx scripts/seed-economy-opportunity.ts \
 *     --title "..." --category content_production --revenue 12000 --cost 1500 \
 *     --hours 2 --probability 0.6 --risk low
 *
 * Prints JSON: { opportunityId, duplicate }.
 */
import { createHash } from 'node:crypto';
import { insertOpportunity } from '../src/db/economy-repositories';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name);
  const value = Number(raw);
  return raw === undefined || !Number.isFinite(value) ? fallback : value;
}

const title = arg('title');
if (!title) {
  console.error('usage: --title "<owner-assigned work item>" [--category ...] [--revenue cents] [--cost cents] [--hours n] [--probability 0-1] [--risk low|medium|high]');
  process.exit(2);
}

const reference = arg('ref') ?? `owner-assigned-${Date.now()}`;
const sourceUrl = `owner-assigned://${reference}`;
const category = arg('category', 'content_production') as string;
const summary = arg('summary', 'Work item assigned directly by the owner of the mission.') as string;

const result = insertOpportunity({
  sourceUrlHash: createHash('sha256').update(sourceUrl).digest('hex'),
  sourceUrl,
  category,
  title,
  summary,
  expectedRevenueCents: Math.round(numberArg('revenue', 5000)),
  expectedCostCents: Math.round(numberArg('cost', 500)),
  timeHours: numberArg('hours', 1),
  riskLevel: arg('risk', 'low') as string,
  probability: numberArg('probability', 0.5),
  estimateBasis: 'owner_assigned_work_item',
});

console.log(JSON.stringify({ opportunityId: result.id, duplicate: result.duplicate, sourceUrl }));
