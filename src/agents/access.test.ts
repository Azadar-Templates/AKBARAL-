import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, createUser } from '../db';
import { agentFactory } from '../orchestrator/agent-factory';
import { createAgentTask } from '../orchestrator/executor';
import { discoverAgents, getAgentBySlug, isAgentVisibleToUser } from './registry';

const suffix = randomBytes(6).toString('hex');

describe('agent access control', () => {
  let ownerId = '';
  let otherId = '';
  let slug = '';

  before(() => {
    const owner = createUser({ email: `owner-${suffix}@akbaral.test`, name: 'Owner' });
    const other = createUser({ email: `other-${suffix}@akbaral.test`, name: 'Other' });
    ownerId = owner.id;
    otherId = other.id;
    const created = agentFactory.create({
      userId: ownerId,
      name: `Private ${suffix}`,
      specialization: 'Private Workflow',
      description: 'private',
      systemInstructions: 'Never fabricate evidence.',
      slug: `private-${suffix}`,
    });
    slug = created.slug;
  });

  after(() => {
    db.run('DELETE FROM users WHERE id IN (?, ?)', [ownerId, otherId]);
    db.close();
  });

  it('hides unpublished custom agents from other users', () => {
    const agent = getAgentBySlug(slug);
    assert.ok(agent);
    assert.equal(isAgentVisibleToUser(agent, ownerId), true);
    assert.equal(isAgentVisibleToUser(agent, otherId), false);

    const listing = discoverAgents({ userId: otherId, query: suffix, limit: 50 });
    assert.equal(listing.agents.some((row) => row.slug === slug), false);

    const ownerListing = discoverAgents({ userId: ownerId, query: suffix, limit: 50 });
    assert.ok(ownerListing.agents.some((row) => row.slug === slug));
  });

  it('refuses to execute another user unpublished agent', () => {
    assert.throws(() => {
      createAgentTask({ userId: otherId, agentSlug: slug, goal: 'attempt private dispatch' });
    }, /does not exist/);
    // Owner can dispatch (task is created; we never run it to avoid exercising provider).
    const dispatched = createAgentTask({ userId: ownerId, agentSlug: slug, goal: 'owner dispatch' });
    assert.ok(dispatched.taskId);
  });

  it('publishes the agent for everyone', () => {
    db.run(
      `UPDATE agent_marketplace SET status = 'published' WHERE agent_id = (SELECT id FROM agents WHERE slug = ?)`,
      [slug],
    );
    const agent = getAgentBySlug(slug);
    assert.ok(agent);
    assert.equal(isAgentVisibleToUser(agent, otherId), true);
    assert.ok(discoverAgents({ userId: otherId, query: suffix, limit: 50 }).agents.some((row) => row.slug === slug));
  });
});
