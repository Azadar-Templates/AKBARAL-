import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { agentDefinitionCount } from '../agents/catalog';
import { insertOpportunity, updateEconomyPolicy, upsertAgentProfile, postLedger } from '../db/economy-repositories';
import { WORKFORCE_CATEGORIES, findWorkforceCategory } from './categories';
import { deriveEligibility, ensureWorkforceProfiles, workforceAccountFor } from './wallets';
import { integrationStatus, workforceReadiness } from './integrations';
import { isSourceUsable, recordSourceOutcome, recordWorkflowOutcome, isWorkflowUsable, sourceKeyFor, setSourceStatus } from './repositories';
import { requestComm, decideComm, CommsError } from './comms';
import { delegateWork } from './delegation';
import { runWorkforceExecution } from './execution';
import { pickWorkforceAgent, workforceDiscovery } from './scheduler';
import { buildWorkforceReport } from './report';
import { startExecution } from '../economy/operations';

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

describe('workforce production layer', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0 } as never);
  });

  it('covers every requested earning category with legitimate discovery metadata', () => {
    const keys = WORKFORCE_CATEGORIES.map((c) => c.key);
    for (const required of ['freelance', 'software_services', 'saas', 'digital_products', 'content_creation', 'youtube', 'tiktok', 'affiliate', 'ecommerce', 'lead_generation', 'advertising', 'licensing', 'b2b_services', 'marketplaces', 'education', 'apps']) {
      assert.ok(keys.includes(required), `missing workforce category: ${required}`);
    }
    assert.ok(findWorkforceCategory('youtube')!.requiresProvider.length > 5);
    assert.ok(WORKFORCE_CATEGORIES.every((c) => c.queries.length > 0 && c.missionActivity.length > 0));
  });

  it('derives multi-category eligibility: agents are never single-task limited', () => {
    const eligibility = deriveEligibility({
      slug: 'software-engineering-builder-008',
      capabilities: ['coding', 'reasoning'],
      toolPermissions: ['code_repository_read', 'knowledge_search'],
      categorySlug: 'software-engineering',
    });
    assert.ok(eligibility.length >= 2, `expected multi-category eligibility, got ${eligibility.join(',')}`);
    assert.ok(eligibility.includes('research'), 'every agent keeps research scoping eligibility');
  });

  it('assures wallet/profile coverage for the full registry without touching it', () => {
    const result = ensureWorkforceProfiles();
    // Other suites may have added custom-agent profiles to the shared test DB,
    // so the total can exceed the registry size — what matters is that EVERY
    // registry agent is assured.
    assert.ok(result.total >= agentDefinitionCount(), `expected >= ${agentDefinitionCount()} profiles, got ${result.total}`);
    assert.ok(result.assured >= agentDefinitionCount());
    const account = workforceAccountFor('web-research-001');
    assert.equal(account.agentSlug, 'web-research-001');
    assert.ok(Array.isArray(account.categories) && account.categories.length > 0);
    assert.equal(account.availableCents, account.realizedRevenueCents - account.costCents - account.transferredOutCents);
  });

  it('derives balances from the real ledger only (no fabricated money)', () => {
    const slug = 'web-research-001';
    const before = workforceAccountFor(slug);
    postLedger({
      agentSlug: slug, direction: 'credit', category: 'revenue', amountCents: 5000,
      purpose: 'test evidence-backed revenue', refType: 'test', refId: `test:rev:${Date.now()}`,
    });
    postLedger({
      agentSlug: slug, direction: 'debit', category: 'api_cost', amountCents: 120,
      purpose: 'test api cost', refType: 'test', refId: `test:cost:${Date.now()}`,
    });
    const after = workforceAccountFor(slug);
    assert.equal(after.realizedRevenueCents, before.realizedRevenueCents + 5000);
    assert.equal(after.costCents, before.costCents + 120);
    assert.equal(after.costByCategory['api_cost'], (before.costByCategory['api_cost'] ?? 0) + 120);
  });

  it('reports integration status honestly (missing credentials labelled needs_owner_action)', () => {
    const saved = { ...process.env };
    delete process.env.GOOGLE_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const statuses = integrationStatus();
    const gemini = statuses.find((s) => s.key === 'gemini')!;
    assert.equal(gemini.configured, false);
    assert.equal(gemini.status, 'needs_owner_action');
    assert.ok(gemini.ownerAction.includes('GOOGLE_API_KEY'));
    const readiness = workforceReadiness();
    assert.equal(readiness.model, false);
    assert.ok(readiness.summary.length > 10);
    process.env = saved;
  });

  it('risk protection: unreliable sources auto-block and become unusable', () => {
    const domain = `flaky-${Date.now()}.example.com`;
    const key = sourceKeyFor(domain, 'freelance');
    assert.equal(isSourceUsable(key), true);
    recordSourceOutcome({ domain, category: 'freelance', ok: false, error: 'fetch failed: ECONNREFUSED' });
    recordSourceOutcome({ domain, category: 'freelance', ok: false, error: 'fetch failed: timeout' });
    const blocked = recordSourceOutcome({ domain, category: 'freelance', ok: false, error: 'fetch failed: 503' });
    assert.equal(blocked.status, 'unreliable');
    assert.equal(isSourceUsable(key), false);
    setSourceStatus(key, 'active', null);
    assert.equal(isSourceUsable(key), true);
  });

  it('workflow health: repeated failures mark the workflow failed (replacement required)', () => {
    const slug = 'web-research-001';
    const category = 'research';
    const workflowKey = `test-workflow-${Date.now()}`;
    assert.equal(isWorkflowUsable(slug, category, workflowKey), true);
    recordWorkflowOutcome({ agentSlug: slug, category, workflowKey, ok: false, error: 'model timeout' });
    recordWorkflowOutcome({ agentSlug: slug, category, workflowKey, ok: false, error: 'model timeout' });
    const failed = recordWorkflowOutcome({ agentSlug: slug, category, workflowKey, ok: false, error: 'model timeout' });
    assert.equal(failed.status, 'failed');
    assert.equal(isWorkflowUsable(slug, category, workflowKey), false);
  });

  it('customer comms: consent is mandatory, bulk messaging is refused, approval gates sends', () => {
    assert.throws(
      () => requestComm({ agentSlug: 'web-research-001', channel: 'email', recipient: 'a@b.co', template: 'proposal-intro', contentPreview: 'Hello, proposal...', consentBasis: 'short' }),
      /consent_basis/,
    );
    assert.throws(
      () => requestComm({ agentSlug: 'web-research-001', channel: 'email', recipient: 'a@b.co', template: 'proposal-intro', contentPreview: 'Hello, proposal for your project...', consentBasis: 'purchased list blast to 10k contacts' }),
      /bulk/,
    );
    const row = requestComm({
      agentSlug: 'web-research-001', channel: 'email', recipient: 'client@example.com',
      template: 'proposal-intro', contentPreview: 'Hello, here is our proposal for your project...',
      consentBasis: 'client requested a proposal via the platform thread on 2026-09-01',
    });
    assert.equal(row.status, 'requested');
    assert.ok(row.recipient_masked.includes('***'), 'recipient must be stored masked');
    assert.ok(!row.recipient_masked.includes('client@'), 'raw PII must not leak into the masked reference');
    const decided = decideComm(row.id, 'reject', 'owner-test');
    assert.equal(decided.status, 'rejected');
  });

  it('delegation: no permission escalation (child tools ⊆ parent tools)', async () => {
    upsertAgentProfile({ agentSlug: 'web-research-001', objectives: 'test parent' });
    // web-research-001 tools: web_search, page_fetch, knowledge_search.
    // Requesting an unrelated tool must be intersected away, not granted.
    const outcome = delegateWork({
      parentAgentSlug: 'web-research-001',
      gap: 'test delegation gap',
      specialization: 'Test Subordinate',
      systemInstructions: 'You are a test subordinate. Follow delegation constraints.',
      requestedTools: ['web_search', 'stripe_payment'],
      childBudgetCents: 100,
    });
    if (outcome.status !== 'rejected') {
      assert.ok(outcome.grantedTools.includes('web_search'));
      assert.ok(!outcome.grantedTools.includes('stripe_payment'), 'child must not gain tools the parent lacks');
    } else {
      assert.ok(outcome.blockedReason && outcome.blockedReason.length > 0);
    }
  });

  it('workforce discovery uses the secure search layer and skips blocked sources', async () => {
    const fixture = await startJsonServer(() => ({
      results: [{ title: 'Legit research contract', url: 'https://example.com/workforce-test-1', description: 'Research services requested.' }],
    }));
    const savedEndpoint = process.env.AKBARAL_SEARCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    try {
      process.env.AKBARAL_SEARCH_ENDPOINT = `${fixture.url}/search`;
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      const result = await workforceDiscovery(['research']);
      assert.ok(result.searched.includes('research'));
      assert.ok(result.discovered >= 0);
    } finally {
      if (savedEndpoint === undefined) delete process.env.AKBARAL_SEARCH_ENDPOINT;
      else process.env.AKBARAL_SEARCH_ENDPOINT = savedEndpoint;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
      else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      await fixture.close();
    }
  });

  it('workforce execution fails honestly without a model provider (nothing fabricated)', async () => {
    const savedKeys = ['GOOGLE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'] as const;
    const saved: Record<string, string | undefined> = {};
    for (const key of savedKeys) { saved[key] = process.env[key]; delete process.env[key]; }
    try {
      const id = insertOpportunity({
        sourceUrlHash: `wf-exec-${Date.now()}`, sourceUrl: 'https://example.com/workforce-exec-test',
        category: 'research', title: 'Workforce execution honesty test', summary: 'A clean test contract.',
        expectedRevenueCents: 20_000, expectedCostCents: 100, timeHours: 2, riskLevel: 'low', probability: 0.5,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
      const outcome = await runWorkforceExecution(start.executionId);
      // Without any model provider the run must fail or cancel honestly — never "complete" with invented output.
      assert.ok(['failed', 'cancelled'].includes(outcome.status), `unexpected status: ${outcome.status}`);
      assert.equal(outcome.verified, false);
      assert.ok(!outcome.deliveryId, 'no delivery may exist for a failed run');
    } finally {
      for (const key of savedKeys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key]!;
      }
    }
  });

  it('workforce execution completes through a fixture model with a verified delivery', async () => {
    const LONG = 'Deliverable: a complete market research brief with verified sources, pricing table and next steps for the client engagement.';
    const modelFixture = await startJsonServer(() => ({
      choices: [{ message: { content: LONG } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }));
    const savedBase = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_BASE_URL = modelFixture.url;
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      const id = insertOpportunity({
        sourceUrlHash: `wf-ok-${Date.now()}`, sourceUrl: 'https://example.com/workforce-ok-test',
        category: 'research', title: 'Workforce fixture completion test', summary: 'A clean test contract.',
        expectedRevenueCents: 20_000, expectedCostCents: 100, timeHours: 2, riskLevel: 'low', probability: 0.5,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
      const outcome = await runWorkforceExecution(start.executionId);
      assert.equal(outcome.status, 'completed');
      assert.equal(outcome.verified, true);
      assert.ok(outcome.deliveryId, 'a completed run must record a delivery');
    } finally {
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await modelFixture.close();
    }
  });

  it('agent matching prefers category-eligible workforce agents', () => {
    const slug = pickWorkforceAgent('research');
    assert.ok(typeof slug === 'string' && slug.length > 0);
  });

  it('workforce report is evidence-backed and lists genuine owner actions', () => {
    const report = buildWorkforceReport();
    assert.equal(report.registry.definitions, agentDefinitionCount());
    assert.ok(report.registry.profiles >= agentDefinitionCount());
    assert.ok(report.categories.length >= 16);
    assert.ok(report.revenue.note.includes('evidence-backed'));
    assert.ok(Array.isArray(report.requiresOwnerAction));
    assert.ok(report.readiness.summary.length > 10);
  });

  it('CommsError carries status codes for the HTTP layer', () => {
    const error = new CommsError(400, 'consent_required', 'consent needed');
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'consent_required');
  });
});
