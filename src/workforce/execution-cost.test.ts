import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { insertOpportunity, updateEconomyPolicy } from '../db/economy-repositories';
import { modelRouter } from '../models/router';
import { runExecution, startExecution } from '../economy/operations';
import { runWorkforceExecution } from './execution';

const PRICED_MODEL = 'd10-test-model';
const FREE_MODEL = 'd10-free-model';

function startJsonServer(handler: (req: http.IncomingMessage, body: string) => unknown): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(handler(req, raw)));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

function lastModelRunCost(modelKey: string): number | null {
  const row = db.get<{ cost_cents: number }>(
    'SELECT cost_cents FROM model_runs WHERE model_key = ? AND status = ? ORDER BY rowid DESC LIMIT 1', [modelKey, 'succeeded'],
  );
  return row ? Number(row.cost_cents) : null;
}

describe('D10 real model cost reaches the execution ledger', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0, economy_model_key: null } as never);
    // Deterministic priced + free models (OpenAI-compatible transport, fixture base URL per test).
    db.run(
      `INSERT OR IGNORE INTO models (id, key, name, provider_key, capability, cost_input_per_million_cents, cost_output_per_million_cents, strengths, status)
       VALUES (?, ?, ?, 'openai', 'llm', 100, 400, ?, 'enabled')`,
      ['mdl_d10_priced', PRICED_MODEL, 'D10 priced test model', JSON.stringify(['research'])],
    );
    db.run(
      `INSERT OR IGNORE INTO models (id, key, name, provider_key, capability, cost_input_per_million_cents, cost_output_per_million_cents, strengths, status)
       VALUES (?, ?, ?, 'openai', 'llm', 0, 0, ?, 'enabled')`,
      ['mdl_d10_free', FREE_MODEL, 'D10 free test model', JSON.stringify(['research'])],
    );
    // Registry sync retires unknown models, including fixtures from a prior run.
    db.run("UPDATE models SET status = 'enabled' WHERE key IN (?, ?)", [PRICED_MODEL, FREE_MODEL]);
  });

  it('router returns usage with the same cost it records in model_runs', async () => {
    const fixture = await startJsonServer(() => ({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }));
    const savedBase = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_BASE_URL = fixture.url;
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      const result = await modelRouter.complete(
        { capability: ['research'], preferredModelKey: PRICED_MODEL },
        [{ role: 'user' as const, content: 'ping' }],
      );
      // ceil((100*1000 + 400*500) / 1e6) = ceil(0.3) = 1c
      assert.equal(result.usage?.costCents, 1);
      assert.equal(result.usage?.inputTokens, 1000);
      assert.equal(result.usage?.outputTokens, 500);
      assert.equal(lastModelRunCost(PRICED_MODEL), 1);
    } finally {
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await fixture.close();
    }
  });

  it('workforce execution posts the real model cost to the ledger (no more 0c gap)', async () => {
    const LONG = 'Deliverable: a complete market research brief with verified sources, pricing table and next steps for the client engagement.';
    const fixture = await startJsonServer(() => ({
      choices: [{ message: { content: LONG } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }));
    const savedBase = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    const savedFetch = process.env.AKBARAL_PAGE_FETCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    const stamp = Date.now();
    try {
      process.env.OPENAI_BASE_URL = fixture.url;
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      process.env.AKBARAL_PAGE_FETCH_ENDPOINT = fixture.url;
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      updateEconomyPolicy({ economy_model_key: PRICED_MODEL } as never);
      const id = insertOpportunity({
        sourceUrlHash: `d10-wf-${stamp}`, sourceUrl: 'https://example.com/d10-workforce-cost',
        category: 'research', title: 'D10 workforce cost test', summary: 'A clean test contract.',
        expectedRevenueCents: 20_000, expectedCostCents: 100, timeHours: 2, riskLevel: 'low', probability: 0.5,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
      const outcome = await runWorkforceExecution(start.executionId);
      assert.equal(outcome.status, 'completed');
      const execution = db.get<{ cost_cents: number }>('SELECT cost_cents FROM economy_executions WHERE id = ?', [start.executionId]);
      assert.ok(execution && Number(execution.cost_cents) > 0, `execution cost must be real, got ${execution?.cost_cents}`);
      const debit = db.get<{ amount_cents: number }>('SELECT amount_cents FROM economy_ledger WHERE ref_id = ?', [`exec:${start.executionId}:api_cost`]);
      assert.ok(debit, 'api_cost ledger debit must exist');
      assert.equal(Number(debit.amount_cents), Number(execution.cost_cents));
      assert.equal(Number(debit.amount_cents), lastModelRunCost(PRICED_MODEL));
    } finally {
      if (savedFetch === undefined) delete process.env.AKBARAL_PAGE_FETCH_ENDPOINT; else process.env.AKBARAL_PAGE_FETCH_ENDPOINT = savedFetch;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER; else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      updateEconomyPolicy({ economy_model_key: null } as never);
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await fixture.close();
    }
  });

  it('economy execution posts the real model cost to the ledger', async () => {
    const LONG = 'Deliverable: a complete market research brief with verified sources, pricing table and next steps for the client engagement.';
    const fixture = await startJsonServer(() => ({
      choices: [{ message: { content: LONG } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }));
    const savedBase = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    const savedFetch = process.env.AKBARAL_PAGE_FETCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    const stamp = Date.now();
    try {
      process.env.OPENAI_BASE_URL = fixture.url;
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      process.env.AKBARAL_PAGE_FETCH_ENDPOINT = fixture.url;
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      updateEconomyPolicy({ economy_model_key: PRICED_MODEL } as never);
      const id = insertOpportunity({
        sourceUrlHash: `d10-eco-${stamp}`, sourceUrl: 'https://example.com/d10-economy-cost',
        category: 'research', title: 'D10 economy cost test', summary: 'A clean test contract.',
        expectedRevenueCents: 20_000, expectedCostCents: 100, timeHours: 2, riskLevel: 'low', probability: 0.5,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
      const outcome = await runExecution(start.executionId);
      assert.equal(outcome.status, 'completed');
      const debit = db.get<{ amount_cents: number }>('SELECT amount_cents FROM economy_ledger WHERE ref_id = ?', [`exec:${start.executionId}:api_cost`]);
      assert.ok(debit, 'api_cost ledger debit must exist');
      assert.ok(Number(debit.amount_cents) > 0);
      assert.equal(Number(debit.amount_cents), lastModelRunCost(PRICED_MODEL));
    } finally {
      if (savedFetch === undefined) delete process.env.AKBARAL_PAGE_FETCH_ENDPOINT; else process.env.AKBARAL_PAGE_FETCH_ENDPOINT = savedFetch;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER; else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      updateEconomyPolicy({ economy_model_key: null } as never);
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await fixture.close();
    }
  });

  it('zero-cost usage posts no ledger debit (real usage only, nothing fabricated)', async () => {
    const LONG = 'Deliverable: a complete market research brief with verified sources, pricing table and next steps for the client engagement.';
    const fixture = await startJsonServer(() => ({
      choices: [{ message: { content: LONG } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }));
    const savedBase = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    const savedFetch = process.env.AKBARAL_PAGE_FETCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    const stamp = Date.now();
    try {
      process.env.OPENAI_BASE_URL = fixture.url;
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      process.env.AKBARAL_PAGE_FETCH_ENDPOINT = fixture.url;
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      updateEconomyPolicy({ economy_model_key: FREE_MODEL } as never);
      const id = insertOpportunity({
        sourceUrlHash: `d10-free-${stamp}`, sourceUrl: 'https://example.com/d10-free-cost',
        category: 'research', title: 'D10 free cost test', summary: 'A clean test contract.',
        expectedRevenueCents: 20_000, expectedCostCents: 100, timeHours: 2, riskLevel: 'low', probability: 0.5,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
      const outcome = await runExecution(start.executionId);
      assert.equal(outcome.status, 'completed');
      const debit = db.get<{ amount_cents: number }>('SELECT amount_cents FROM economy_ledger WHERE ref_id = ?', [`exec:${start.executionId}:api_cost`]);
      assert.equal(debit, undefined);
      const execution = db.get<{ cost_cents: number }>('SELECT cost_cents FROM economy_executions WHERE id = ?', [start.executionId]);
      assert.equal(Number(execution!.cost_cents), 0);
    } finally {
      if (savedFetch === undefined) delete process.env.AKBARAL_PAGE_FETCH_ENDPOINT; else process.env.AKBARAL_PAGE_FETCH_ENDPOINT = savedFetch;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER; else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      updateEconomyPolicy({ economy_model_key: null } as never);
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await fixture.close();
    }
  });
});
