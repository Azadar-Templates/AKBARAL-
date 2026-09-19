/**
 * REAL end-to-end workforce execution with ONE agent via the REAL Google provider.
 *
 * Runs ONLY where outbound egress to Google exists (GitHub Actions runner with
 * the GOOGLE_API_KEY secret, production host) — NOT in the Arena sandbox
 * (egress blocked, no key). Exercises this commit's REAL production code path:
 *
 *   opportunity → evaluate → startExecution (owner-authorized) →
 *   runWorkforceExecution → modelRouter → Google Gemini → verification →
 *   delivery record + ledger + model_runs accounting
 *
 * Anti-fixture guards: refuses to run when OPENAI_BASE_URL is set (that would
 * route to a fixture, not Google) and exits 2 when GOOGLE_API_KEY is absent
 * (\"could not run\" — never a fake pass). NO secret material is ever printed.
 *
 * Usage (runner only):
 *   DATABASE_URL=file:./.workforce-live.db GOOGLE_API_KEY=<real key> npx tsx scripts/verify-workforce-live-exec.ts
 *
 * Evidence lines (stable prefixes, consumed by the workflow annotations):
 *   MODEL= / PROVIDER= / LATENCY_MS= / INPUT_TOKENS= / OUTPUT_TOKENS= /
 *   COST_CENTS= / VERIFIED= / DELIVERY= / OUTPUT_SHA= / OUTPUT_PREVIEW= / VERDICT= / ERROR=
 */
import { createHash } from 'node:crypto';

function fail(message: string): never {
  console.log(`ERROR=${message.slice(0, 500)}`);
  console.log('VERDICT=FAIL');
  process.exit(1);
}

function couldNotRun(message: string): never {
  console.log(`ERROR=${message.slice(0, 500)}`);
  console.log('VERDICT=COULD_NOT_RUN');
  process.exit(2);
}

async function main(): Promise<void> {
  console.log('workforce LIVE execution verification (one agent, real Google provider)');
  console.log(`GOOGLE_API_KEY present: ${process.env.GOOGLE_API_KEY ? 'yes' : 'no'}`);

  if (!process.env.GOOGLE_API_KEY) {
    couldNotRun('GOOGLE_API_KEY is not set in this environment — nothing to verify');
  }
  // Anti-fixture: a base-URL override would divert the call away from Google.
  if ((process.env.OPENAI_BASE_URL ?? '').trim()) {
    couldNotRun('OPENAI_BASE_URL is set — refusing: that would be a fixture call, not the real Google provider');
  }
  if ((process.env.GOOGLE_BASE_URL ?? '').trim()) {
    couldNotRun('GOOGLE_BASE_URL is set — refusing: that would bypass the production Google endpoint');
  }

  const { db } = await import('../src/db/database');
  const { applyMigrations } = await import('../src/db/migrate');
  const { syncAgentRegistry, getAgentBySlug } = await import('../src/agents/registry');
  const { modelRouter } = await import('../src/models/router');
  const { insertOpportunity, getExecution } = await import('../src/db/economy-repositories');
  const { evaluateOpportunity, startExecution } = await import('../src/economy/operations');
  const { runWorkforceExecution } = await import('../src/workforce/execution');
  const { listDeliveries } = await import('../src/workforce/repositories');

  applyMigrations(db);
  const sync = syncAgentRegistry();
  console.log(`registry synced (total definitions: ${sync.total})`);

  const agentSlug = 'web-research-001';
  const agent = getAgentBySlug(agentSlug);
  if (!agent) fail(`agent ${agentSlug} missing after registry sync`);

  // Routing preview: exact model/provider the production router selects.
  const chain = modelRouter.routeChain({ capability: ['research'] });
  const primary = chain[0];
  console.log(`ROUTED_MODEL=${primary.model.key}`);
  console.log(`ROUTED_PROVIDER=${primary.providerKey}`);
  console.log(`ROUTED_AVAILABLE=${primary.available ? 'yes' : 'no'}`);
  if (!primary.available) {
    fail(`router selected ${primary.model.key} but it is not available (${primary.reason})`);
  }
  if (primary.providerKey !== 'google') {
    fail(`expected the google provider, router selected ${primary.providerKey} — not a Google verification`);
  }

  const stamp = Date.now();
  const inserted = insertOpportunity({
    sourceUrlHash: createHash('sha256').update(`live-verify-${stamp}`).digest('hex'),
    sourceUrl: 'https://example.com/',
    category: 'research',
    title: 'Live verification research brief (production provider check)',
    summary: 'Produce a concise market-research brief: three verifiable pricing observations for freelance SEO audits, each tied to an observed source or explicitly marked as unavailable.',
    expectedRevenueCents: 20_000,
    expectedCostCents: 100,
    timeHours: 2,
    riskLevel: 'low',
    probability: 0.5,
  });
  const evaluation = evaluateOpportunity(inserted.id);
  console.log(`EVALUATION=authorized:${evaluation.authorized} blocked:${evaluation.blocked} net:${evaluation.economics.expectedNetCents}c`);
  if (!evaluation.authorized) {
    fail(`opportunity was not authorized: ${evaluation.reasons.join('; ')}`);
  }

  const start = startExecution({ opportunityId: inserted.id, agentSlug, authorizedBy: 'owner' });
  console.log(`EXECUTION=${start.executionId} created:${start.created}`);

  const wallStart = Date.now();
  const outcome = await runWorkforceExecution(start.executionId);
  const wallMs = Date.now() - wallStart;
  console.log(`LATENCY_MS=${wallMs}`);
  console.log(`OUTCOME=${outcome.status} verified:${outcome.verified} tools:${outcome.toolsRan ?? 0}`);

  if (outcome.status !== 'completed' || !outcome.verified || !outcome.deliveryId) {
    fail(`execution did not complete with a verified delivery (status=${outcome.status} error=${outcome.error ?? 'none'})`);
  }

  // Server-side accounting: the model_runs row is the authoritative record.
  const run = db.get<{ model_key: string; provider_key: string; latency_ms: number; input_tokens: number | null; output_tokens: number | null; cost_cents: number | null; status: string }>(
    'SELECT model_key, provider_key, latency_ms, input_tokens, output_tokens, cost_cents, status FROM model_runs ORDER BY created_at DESC LIMIT 1',
  );
  if (!run) fail('no model_runs row recorded — cannot prove which model served the call');
  console.log(`MODEL=${run.model_key}`);
  console.log(`PROVIDER=${run.provider_key}`);
  console.log(`PROVIDER_LATENCY_MS=${run.latency_ms}`);
  console.log(`INPUT_TOKENS=${run.input_tokens ?? 'null'}`);
  console.log(`OUTPUT_TOKENS=${run.output_tokens ?? 'null'}`);
  console.log(`COST_CENTS=${run.cost_cents ?? 'null'}`);
  console.log(`MODEL_RUN_STATUS=${run.status}`);

  const execution = getExecution(start.executionId);
  console.log(`EXECUTION_COST_CENTS=${execution?.cost_cents ?? 'null'}`);
  const deliveries = listDeliveries({ executionId: start.executionId, limit: 1 });
  const delivery = deliveries[0];
  if (!delivery) fail('execution completed but no delivery row exists');
  console.log(`DELIVERY=${delivery.id}`);
  console.log(`DELIVERY_VERIFIED=${delivery.verified === 1 ? 'yes' : 'no'}`);
  const outputPreview = (delivery.evidence.match(/output_preview=([\s\S]*)$/)?.[1] ?? '').slice(0, 400).replace(/\n/g, ' ');
  const outputSha = delivery.evidence.match(/output_sha=([0-9a-f]+)/)?.[1] ?? 'unknown';
  console.log(`OUTPUT_SHA=${outputSha}`);
  console.log(`OUTPUT_PREVIEW=${outputPreview}`);
  console.log('VERDICT=PASS');
}

void main().catch((error: unknown) => {
  console.log(`ERROR=${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`);
  console.log('VERDICT=FAIL');
  process.exit(1);
});
