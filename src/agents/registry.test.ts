import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, createUser } from '../db';
import { syncAgentRegistry, discoverAgents, searchRelevance, listCategories } from './registry';
import type { AgentView } from './registry';

const suffix = randomBytes(6).toString('hex');
let userId = '';

describe('agent registry search and browsing', () => {
  before(() => {
    syncAgentRegistry();
    const user = createUser({ email: `registry-${suffix}@akbaral.test`, name: 'Registry Test' });
    userId = user.id;
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('synced the full 4,000-agent catalog across 80 categories', () => {
    const { total } = discoverAgents({ limit: 1, userId });
    // Other test files may have created on-demand agents (e.g. Agent #001)
    // in this shared test database; the catalog itself must be complete.
    assert.ok(total >= 4000, `expected >= 4000 agents, got ${total}`);
    const categories = listCategories();
    assert.equal(categories.length, 80);
    assert.ok(categories.every((category) => category.count === 50));
  });

  it('ranks search results by relevance, not alphabetically', () => {
    const { agents, total } = discoverAgents({ query: 'shopify ecommerce store', limit: 10, userId });
    assert.ok(total > 0);
    assert.ok(agents.length > 0);
    // The single most relevant match must be the e-commerce category
    // specialist, and the top results must all be genuine e-commerce
    // specialists (other domains' e-commerce analysts may follow).
    const isEcommerce = (text: string): boolean => text.toLowerCase().replace(/-/g, '').includes('ecommerce');
    assert.equal(agents[0].categorySlug, 'e-commerce', `top result was: ${agents[0].slug}`);
    assert.ok(
      agents.slice(0, 3).every((agent) => isEcommerce(agent.specialization)),
      `expected e-commerce specialists on top, got: ${agents.slice(0, 3).map((agent) => agent.slug).join(', ')}`,
    );
  });

  it('keeps category filters working with ranked search', () => {
    const { agents } = discoverAgents({ query: 'research', category: 'research', limit: 10, userId });
    assert.ok(agents.length > 0);
    assert.ok(agents.every((agent) => agent.categorySlug === 'research'));
  });

  it('paginates ranked search consistently', () => {
    const page1 = discoverAgents({ query: 'strategy', limit: 5, offset: 0, userId });
    const page2 = discoverAgents({ query: 'strategy', limit: 5, offset: 5, userId });
    assert.equal(page1.agents.length, 5);
    assert.equal(page2.agents.length, 5);
    const slugs1 = new Set(page1.agents.map((agent) => agent.slug));
    for (const agent of page2.agents) {
      assert.ok(!slugs1.has(agent.slug), 'pages must not overlap');
    }
    assert.equal(page1.total, page2.total);
  });

  it('browse without a query stays alphabetical and stable', () => {
    const page = discoverAgents({ limit: 5, offset: 0, userId });
    const names = page.agents.map((agent) => agent.name);
    // SQLite ORDER BY uses binary collation; mirror it in the expectation.
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(names, sorted);
  });

  it('relevance scoring weights specialization over description mentions', () => {
    const base: AgentView = {
      id: 'a', name: 'X', slug: 'e-commerce-manager-001', ownerId: null,
      specialization: 'Ecommerce Manager', description: 'generic', category: 'E-commerce',
      categorySlug: 'e-commerce', version: '1', status: 'active', systemInstructions: '',
      capabilities: ['research'], inputs: [], outputs: [], modelRequirements: [], toolPermissions: [],
      apiRequirements: [], workflow: [], verificationRules: [], securityPermissions: [],
      costUsage: { estimatedTokens: 0, estimatedCents: 0, priority: 'low' }, fallbackStrategy: '',
      evaluationConfig: { metrics: [], rubric: '', testCases: [] }, tools: [],
    };
    const specialist = searchRelevance(base, 'ecommerce');
    const mentioned = searchRelevance({ ...base, slug: 'writing-author-001', specialization: 'Content Author', description: 'mentions ecommerce once' }, 'ecommerce');
    assert.ok(specialist > mentioned, `specialist (${specialist}) must outrank a description mention (${mentioned})`);
  });
});
