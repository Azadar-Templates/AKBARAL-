import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { generateAgentDefinitions } from '../agents/catalog';
import { insertOpportunity, updateEconomyPolicy } from '../db/economy-repositories';
import { startExecution } from '../economy/operations';
import { runWorkforceExecution } from './execution';
import {
  ImageError,
  decideImageRequest,
  ensureImageBrief,
  fulfillImageRequest,
  getImageRequest,
  listImageRequests,
  requestImage,
} from './images';

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

describe('governed image path (paid controls intact)', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0 } as never);
  });

  it('validates briefs (no empty prompts, no missing agent)', () => {
    assert.throws(() => requestImage({ agentSlug: '', prompt: 'a proper image description here' }), (error: unknown) => {
      assert.ok(error instanceof ImageError && error.statusCode === 400);
      return true;
    });
    assert.throws(() => requestImage({ agentSlug: 'design-test', prompt: 'short' }), (error: unknown) => {
      assert.ok(error instanceof ImageError && error.statusCode === 400);
      return true;
    });
  });

  it('approve → fulfill without OPENAI_API_KEY fails honestly (no spend, no fake image)', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      const brief = requestImage({ agentSlug: 'design-test', prompt: 'A clean product hero image, minimal studio background' });
      assert.equal(brief.status, 'requested');
      const approved = decideImageRequest(brief.id, 'approve', 'owner:test');
      assert.equal(approved.status, 'approved');
      const done = await fulfillImageRequest(brief.id);
      assert.equal(done.status, 'failed');
      assert.match(done.error_message ?? '', /provider_not_configured/);
      assert.match(done.error_message ?? '', /OPENAI_API_KEY/);
      assert.equal(done.result_ref, null);
    } finally {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    }
  });

  it('fulfillment refuses anything but approved briefs (the paid gate holds)', async () => {
    const brief = requestImage({ agentSlug: 'design-test', prompt: 'An infographic about honest ledger accounting practices' });
    await assert.rejects(() => fulfillImageRequest(brief.id), (error: unknown) => {
      assert.ok(error instanceof ImageError && error.statusCode === 409);
      return true;
    });
    const rejected = decideImageRequest(brief.id, 'reject', 'owner:test');
    assert.equal(rejected.status, 'rejected');
    await assert.rejects(() => fulfillImageRequest(brief.id), /approve it before fulfillment/);
    assert.throws(() => decideImageRequest(brief.id, 'approve', 'owner:test'), /not decidable/);
  });

  it('filing is idempotent per execution (retries never duplicate briefs)', () => {
    const executionId = `dimg-${Date.now()}`;
    const first = ensureImageBrief({ executionId, agentSlug: 'design-test', prompt: 'A banner for the quarterly honest-earnings report cover' });
    const second = ensureImageBrief({ executionId, agentSlug: 'design-test', prompt: 'A banner for the quarterly honest-earnings report cover' });
    assert.equal(first.id, second.id);
    assert.equal(listImageRequests().filter((r) => r.execution_id === executionId).length, 1);
  });

  it('image-permitted agents file a brief during execution (never render, even with a key present)', async () => {
    const def = generateAgentDefinitions().find((d) => d.toolPermissions.length === 1 && d.toolPermissions[0] === 'image_render');
    assert.ok(def, 'registry must contain a sole-image_render agent');
    const LONG = 'Deliverable: a complete visual design brief with layout, palette, typography and export checklist for the client.';
    const modelFixture = await startJsonServer(() => ({
      choices: [{ message: { content: LONG } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }));
    const savedBase = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    try {
      // Key present (needed for the model fixture) — the image tool must STILL not run itself.
      process.env.OPENAI_BASE_URL = modelFixture.url;
      process.env.OPENAI_API_KEY = 'test-fixture-key';
      const id = insertOpportunity({
        sourceUrlHash: `dimg-exec-${Date.now()}`, sourceUrl: 'https://example.com/dimg-exec',
        category: 'design', title: 'Design brief packaging test', summary: 'Package the client design brief.',
        expectedRevenueCents: 28_000, expectedCostCents: 120, timeHours: 6, riskLevel: 'low', probability: 0.12,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: def.slug, authorizedBy: 'owner' });
      const outcome = await runWorkforceExecution(start.executionId);
      assert.equal(outcome.status, 'completed');
      const briefs = listImageRequests().filter((r) => r.execution_id === start.executionId);
      assert.equal(briefs.length, 1);
      assert.equal(briefs[0].status, 'requested', 'execution files the brief but never approves or fulfills it');
      assert.equal(briefs[0].agent_slug, def.slug);
      assert.equal(getImageRequest(briefs[0].id)!.result_ref, null);
    } finally {
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await modelFixture.close();
    }
  });
});
