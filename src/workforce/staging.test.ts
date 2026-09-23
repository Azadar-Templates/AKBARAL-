import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
// Keep persistent negative workflow fixtures from other suites isolated; never
// reset production circuit breakers to make a positive fixture runnable.
process.env.DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `staging-${process.pid}.db`)}`;
const { db } = require('../db') as typeof import('../db');
const { applyMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const { syncAgentRegistry } = require('../agents/registry') as typeof import('../agents/registry');
const { indexKnowledgeItem } = require('../db/platform-repositories') as typeof import('../db/platform-repositories');
const { insertOpportunity, updateEconomyPolicy } = require('../db/economy-repositories') as typeof import('../db/economy-repositories');
const { runTool } = require('../tools') as typeof import('../tools');
const { UPLOAD_DIR } = require('../services/files') as typeof import('../services/files');
const { WORKFORCE_SERVICE_USER } = require('./identity') as typeof import('./identity');
const {
  StagingError,
  listStagedFiles,
  listStagedKnowledge,
  resolveStagedFile,
  searchStagedKnowledge,
  stageFile,
  stageKnowledgeItem,
  unstageFile,
  unstageKnowledgeItem,
} = require('./staging') as typeof import('./staging');
const { startExecution } = require('../economy/operations') as typeof import('../economy/operations');
const { runWorkforceExecution } = require('./execution') as typeof import('./execution');

after(() => db.close());

const SERVICE_CTX = { userId: WORKFORCE_SERVICE_USER, projectId: null, taskId: null, executionId: null };
const EMPTY_CTX = { userId: '', projectId: null, taskId: null, executionId: null };
const D5_OWNER = 'usr_d5_owner';

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

describe('D5 workforce service identity + explicit staging', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0 } as never);
    const now = new Date().toISOString();
    db.run("INSERT OR IGNORE INTO users (id, email, password_hash, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)",
      [D5_OWNER, 'd5-owner@akbaral.test', null, 'D5 Owner', now, now]);
  });

  it('empty user context still hard-fails (the gate is preserved, not weakened)', async () => {
    const knowledge = await runTool('knowledge_search', { query: 'anything' }, EMPTY_CTX);
    assert.equal(knowledge.ok, false);
    assert.match(knowledge.error ?? '', /user context missing/);
    const file = await runTool('file_parse_text', { file: 'nope.txt' }, EMPTY_CTX);
    assert.equal(file.ok, false);
  });

  it('service identity with nothing staged finds nothing (honest empty, no leak)', async () => {
    const marker = `d5empty${Date.now()}`;
    indexKnowledgeItem({ userId: D5_OWNER, title: 'unstaged', content: `secret ${marker} content` });
    const result = await runTool('knowledge_search', { query: marker }, SERVICE_CTX);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data?.results as unknown[]) ?? [], []);
    const file = await runTool('file_parse_text', { file: 'definitely-not-staged.txt' }, SERVICE_CTX);
    assert.equal(file.ok, false);
    assert.match(file.error ?? '', /not staged for workforce use/);
  });

  it('staged knowledge is searchable by the service; unstaging revokes it', async () => {
    const marker = `d5stage${Date.now()}`;
    const staged = indexKnowledgeItem({ userId: D5_OWNER, title: 'staged brief', content: `Approved brief ${marker} for agents.` });
    indexKnowledgeItem({ userId: D5_OWNER, title: 'private', content: `Private notes ${marker} must not leak.` });
    stageKnowledgeItem({ knowledgeItemId: staged.id, stagedBy: 'owner:test' });
    try {
      const found = searchStagedKnowledge(marker, 10);
      assert.equal(found.length, 1);
      assert.equal(found[0].title, 'staged brief');
      const viaTool = await runTool('knowledge_search', { query: marker }, SERVICE_CTX);
      assert.equal(viaTool.ok, true);
      assert.equal((viaTool.data?.results as unknown[]).length, 1);
      assert.ok(listStagedKnowledge().some((s) => s.knowledgeItemId === staged.id));
    } finally {
      unstageKnowledgeItem(staged.id);
    }
    assert.deepEqual(searchStagedKnowledge(marker, 10), []);
  });

  it('staged files parse through the service; unstaging revokes access', async () => {
    const stamp = Date.now();
    const storageKey = `d5-staged-${stamp}.txt`;
    const fileId = `d5file${stamp}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), 'staged file bytes for the workforce', 'utf8');
    db.run('INSERT INTO files (id, user_id, original_name, storage_key, mime_type) VALUES (?, ?, ?, ?, ?)',
      [fileId, D5_OWNER, 'brief.txt', storageKey, 'text/plain']);
    stageFile({ fileId, stagedBy: 'owner:test' });
    try {
      const resolved = resolveStagedFile(storageKey);
      assert.ok(resolved.endsWith(storageKey));
      const viaTool = await runTool('file_parse_text', { file: storageKey, mime_type: 'text/plain' }, SERVICE_CTX);
      assert.equal(viaTool.ok, true);
      assert.match(viaTool.content, /staged file bytes/);
      assert.ok(listStagedFiles().some((s) => s.fileId === fileId));
      // A user-scoped read of the same key under another user still fails (no widening).
      const other = await runTool('file_parse_text', { file: storageKey }, { userId: 'someone-else', projectId: null, taskId: null, executionId: null });
      assert.equal(other.ok, false);
    } finally {
      unstageFile(fileId);
      db.run('DELETE FROM files WHERE id = ?', [fileId]);
      fs.rmSync(path.join(UPLOAD_DIR, storageKey), { force: true });
    }
    await assert.rejects(async () => resolveStagedFile(storageKey), /not staged for workforce use/);
  });

  it('staging ghosts is refused (404, never silent)', () => {
    assert.throws(() => stageKnowledgeItem({ knowledgeItemId: 'kno-does-not-exist', stagedBy: 'owner:test' }), (error: unknown) => {
      assert.ok(error instanceof StagingError && error.statusCode === 404);
      return true;
    });
    assert.throws(() => stageFile({ fileId: 'file-does-not-exist', stagedBy: 'owner:test' }), (error: unknown) => {
      assert.ok(error instanceof StagingError && error.statusCode === 404);
      return true;
    });
  });

  it('workforce execution runs its tool stage as the service identity end to end', async () => {
    const marker = `d5exec${Date.now()}`;
    const item = indexKnowledgeItem({ userId: D5_OWNER, title: 'exec brief', content: `Execution context ${marker} approved.` });
    stageKnowledgeItem({ knowledgeItemId: item.id, stagedBy: 'owner:test' });
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
        sourceUrlHash: `d5-exec-${Date.now()}`, sourceUrl: 'https://example.com/d5-service-exec',
        category: 'research', title: `Service identity run ${marker}`, summary: 'A clean test contract.',
        expectedRevenueCents: 20_000, expectedCostCents: 100, timeHours: 2, riskLevel: 'low', probability: 0.5,
      }).id;
      const start = startExecution({ opportunityId: id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
      const outcome = await runWorkforceExecution(start.executionId);
      assert.equal(outcome.status, 'completed');
      assert.equal(outcome.verified, true);
      assert.ok((outcome.toolsRan ?? 0) >= 1, 'tool stage must run under the service identity');
    } finally {
      unstageKnowledgeItem(item.id);
      if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = savedBase;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
      await modelFixture.close();
    }
  });
});
