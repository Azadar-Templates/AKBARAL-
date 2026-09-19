import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { updateEconomyPolicy } from '../db/economy-repositories';
import { WORKFORCE_CATEGORIES } from '../workforce/categories';
import {
  ALL_DISCOVERY_CATEGORY_KEYS,
  DISCOVERY_CATEGORIES,
  findAnyDiscoveryCategory,
  findDiscoveryCategory,
  sanitizeDiscoveryCategories,
} from './policy';
import { runDiscovery } from './operations';

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

describe('D4 discovery allow-list sync (legacy + all 21 workforce categories)', () => {
  before(() => {
    applyMigrations(db);
    updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0, discovery_categories_json: '[]' } as never);
  });

  it('union allow-list covers all 13 legacy keys and all 21 workforce keys', () => {
    for (const legacy of DISCOVERY_CATEGORIES) {
      assert.ok(ALL_DISCOVERY_CATEGORY_KEYS.includes(legacy.key), `legacy key dropped: ${legacy.key}`);
    }
    for (const workforce of WORKFORCE_CATEGORIES) {
      assert.ok(ALL_DISCOVERY_CATEGORY_KEYS.includes(workforce.key), `workforce key dropped: ${workforce.key}`);
    }
    assert.equal(ALL_DISCOVERY_CATEGORY_KEYS.length, 26); // 13 legacy + 13 workforce-only (8 overlap)
  });

  it('sanitizer keeps every valid key, drops unknown/non-string input, never throws', () => {
    const input = ['saas', 'freelance', 'saas', 'not-a-category', 42, null, 'design'];
    assert.deepEqual(sanitizeDiscoveryCategories(input), ['saas', 'freelance', 'design']);
    assert.deepEqual(sanitizeDiscoveryCategories('saas'), []);
    assert.deepEqual(sanitizeDiscoveryCategories(undefined), []);
  });

  it('resolver returns legacy entries unchanged and adapts workforce-only entries', () => {
    assert.equal(findAnyDiscoveryCategory('freelance'), findDiscoveryCategory('freelance'));
    const saas = findAnyDiscoveryCategory('saas');
    assert.ok(saas, 'workforce-only key must resolve');
    assert.ok(saas.queries.length > 0);
    assert.equal(saas.defaultRevenueCents, WORKFORCE_CATEGORIES.find((c) => c.key === 'saas')!.defaultRevenueCents);
    assert.equal(findAnyDiscoveryCategory('not-a-category'), undefined);
  });

  it('economy discovery searches an explicit workforce-only key end to end', async () => {
    const marker = `d4-saas-${Date.now()}`;
    const fixture = await startJsonServer(() => ({
      results: [{ title: 'SaaS validation contract', url: `https://example.com/${marker}`, description: 'Micro-SaaS demand signal.' }],
    }));
    const savedEndpoint = process.env.AKBARAL_SEARCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    try {
      process.env.AKBARAL_SEARCH_ENDPOINT = `${fixture.url}/search`;
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      const result = await runDiscovery(['saas']);
      assert.ok(result.searchedCategories.includes('saas'), `saas was not searched: ${JSON.stringify(result)}`);
      assert.ok(result.discovered + result.duplicates >= 1, 'expected the fixture hit to be recorded');
      const row = db.get<{ category: string; estimate_basis: string }>(
        'SELECT category, estimate_basis FROM economy_opportunities WHERE source_url = ?', [`https://example.com/${marker}`],
      );
      assert.ok(row, 'opportunity row must exist');
      assert.equal(row.category, 'saas');
    } finally {
      if (savedEndpoint === undefined) delete process.env.AKBARAL_SEARCH_ENDPOINT;
      else process.env.AKBARAL_SEARCH_ENDPOINT = savedEndpoint;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
      else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      await fixture.close();
    }
  });

  it('policy-stored workforce keys flow into discovery (and policy is restored)', async () => {
    const marker = `d4-policy-${Date.now()}`;
    const fixture = await startJsonServer(() => ({
      results: [{ title: 'Design retainer', url: `https://example.com/${marker}`, description: 'Design systems contract.' }],
    }));
    const savedEndpoint = process.env.AKBARAL_SEARCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    try {
      process.env.AKBARAL_SEARCH_ENDPOINT = `${fixture.url}/search`;
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      updateEconomyPolicy({ discovery_categories_json: JSON.stringify(sanitizeDiscoveryCategories(['design', 'bogus'])) } as never);
      const result = await runDiscovery();
      assert.ok(result.searchedCategories.includes('design'), `design was not searched: ${JSON.stringify(result)}`);
      assert.ok(!result.searchedCategories.includes('bogus'));
    } finally {
      updateEconomyPolicy({ discovery_categories_json: '[]' } as never);
      if (savedEndpoint === undefined) delete process.env.AKBARAL_SEARCH_ENDPOINT;
      else process.env.AKBARAL_SEARCH_ENDPOINT = savedEndpoint;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
      else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      await fixture.close();
    }
  });

  it('autonomy stays OFF (no autonomous spending enabled by this fix)', () => {
    const row = db.get<{ autonomous_enabled: number; discovery_enabled: number }>(
      'SELECT autonomous_enabled, discovery_enabled FROM economy_policy WHERE id = ?', ['global'],
    );
    assert.equal(row!.autonomous_enabled, 0);
    assert.equal(row!.discovery_enabled, 0);
  });
});
