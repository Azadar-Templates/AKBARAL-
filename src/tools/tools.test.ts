import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runTool, listImplementedTools } from './index';
import { createUser, createFile, db, indexKnowledgeItem } from '../db';
import { UPLOAD_DIR, resolveStoredFilePath } from '../services/files';

describe('tool system', () => {
  let userId = '';
  const suffix = randomBytes(4).toString('hex');

  before(() => {
    const user = createUser({ email: `tools-${suffix}@akbaral.test`, name: 'Tool Test' });
    userId = user.id;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('implements the expected tool set', () => {
    const implemented = listImplementedTools();
    for (const key of ['web_search', 'page_fetch', 'code_repository_read', 'file_parse_text', 'knowledge_search', 'excel_build', 'image_render']) {
      assert.ok(implemented.includes(key), `${key} should be implemented`);
    }
  });

  it('reads repository files safely', async () => {
    const result = await runTool('code_repository_read', { path: 'package.json' }, { userId });
    assert.ok(result.ok);
    assert.match(result.content, /"name"/);
  });

  it('blocks repository path traversal', async () => {
    const result = await runTool('code_repository_read', { path: '../outside.txt' }, { userId });
    assert.equal(result.ok, false);
    assert.match(result.content ?? '', /refused/);
  });

  it('parses a text file from uploads', async () => {
    const filename = `tool-test-${suffix}.txt`;
    const content = 'hello akbaral tools\nsecond line';
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), content, 'utf8');
    createFile({
      userId,
      originalName: filename,
      storageKey: filename,
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(content),
      kind: 'document',
    });
    const result = await runTool('file_parse_text', { file: filename, mime_type: 'text/plain' }, { userId });
    assert.ok(result.ok);
    assert.match(result.content, /hello akbaral tools/);
  });

  it('builds a CSV export', async () => {
    const result = await runTool('excel_build', {
      rows: [
        { name: 'Alpha', score: 10 },
        { name: 'Beta', score: 20 },
      ],
    }, { userId });
    assert.ok(result.ok);
    assert.match(result.content, /name,score/);
    assert.equal(result.data?.rows, 2);
  });

  it('searches indexed knowledge', async () => {
    indexKnowledgeItem({
      userId,
      sourceType: 'manual',
      title: `Unique knowledge ${suffix}`,
      content: `The unique phrase ${suffix} appears in this document.`,
    });
    const result = await runTool('knowledge_search', { query: suffix }, { userId });
    assert.ok(result.ok);
    assert.ok((result.data?.results as Array<{ content: string }>).some((row) => String(row.content).includes('unique phrase')));
  });

  it('confines upload storage keys inside the configured upload directory', () => {
    const valid = resolveStoredFilePath(`safe-${suffix}.txt`);
    assert.equal(path.dirname(valid), path.resolve(UPLOAD_DIR));
    for (const bad of ['../escape.txt', '..', '.', 'a/b.txt', '/etc/passwd']) {
      assert.throws(() => resolveStoredFilePath(bad), /storage key|escapes upload directory/);
    }
  });

  it('fails honestly when image credential is missing', async () => {
    const old = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await runTool('image_render', { prompt: 'a robot' }, { userId });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'provider_not_configured');
      assert.equal(result.requiredCredential, 'OPENAI_API_KEY');
    } finally {
      if (old !== undefined) process.env.OPENAI_API_KEY = old;
    }
  });

  it('fails honestly for external provider integrations without credentials', async () => {
    const keys = ['X_BEARER_TOKEN', 'YOUTUBE_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'GOOGLE_API_KEY', 'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'STRIPE_SECRET_KEY'];
    const saved = keys.map((key) => [key, process.env[key]] as const);
    for (const key of keys) delete process.env[key];
    try {
      const result = await runTool('x_post', { text: 'hello' }, { userId });
      assert.equal(result.code, 'provider_not_configured');
      const maps = await runTool('maps_place', { query: 'Karachi' }, { userId });
      assert.equal(maps.code, 'provider_not_configured');
    } finally {
      for (const [key, value] of saved) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  });
});
