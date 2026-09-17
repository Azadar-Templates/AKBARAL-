import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createUser, db, findAgentBySlug } from '../db';
import { agentFactory } from './agent-factory';

describe('agent factory', () => {
  let userId = '';
  const suffix = randomBytes(4).toString('hex');

  before(() => {
    const user = createUser({ email: `factory-${suffix}@akbaral.test`, name: 'Factory Test' });
    userId = user.id;
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('creates, security reviews, benchmarks and versions a custom agent', () => {
    const created = agentFactory.create({
      userId,
      name: `QA Auditor ${suffix}`,
      specialization: 'Quality Assurance Audit',
      description: 'Audits QA evidence.',
      systemInstructions: 'You audit code quality. You never fabricate evidence. You verify every claim.',
      capabilities: ['reasoning', 'coding'],
      toolPermissions: ['code_repository_read', 'knowledge_search'],
      workflow: ['collect evidence', 'grade', 'report'],
      verificationRules: ['evidence required', 'no fabrication'],
      securityPermissions: ['fs:read:workspace', 'data:read'],
    });
    assert.ok(created.slug.endsWith(suffix) || created.slug.includes('quality'));
    const agent = findAgentBySlug(created.slug);
    assert.ok(agent);
    assert.equal(agent.status, 'active');

    const security = agentFactory.securityReview(created.slug);
    assert.ok(security.length >= 1);

    const benchmark = agentFactory.benchmark(created.slug);
    assert.ok(benchmark.score >= 0 && benchmark.score <= 100);
    assert.ok(['A', 'B', 'C', 'D'].includes(benchmark.grade));

    const version = agentFactory.version({ userId, slug: created.slug, changelog: 'bump' });
    assert.equal(version.version, '1.0.1');

    const rollback = agentFactory.rollback({ userId, slug: created.slug, version: '1.0.0' });
    assert.equal(rollback.version, '1.0.0');

    const disabled = agentFactory.setStatus({ userId, slug: created.slug, status: 'disabled' });
    assert.equal(disabled.status, 'disabled');
  });

  it('rejects a duplicate slug', () => {
    const created = agentFactory.create({
      userId,
      name: `Duplicate ${suffix}`,
      specialization: 'Duplicate Specialization',
      description: 'duplicate',
      systemInstructions: 'Instructions with verification.',
      slug: `duplicate-${suffix}`,
    });
    assert.throws(() => {
      agentFactory.create({
        userId,
        name: 'Duplicate Again',
        specialization: 'Duplicate Specialization',
        description: 'duplicate',
        systemInstructions: 'Instructions with verification.',
        slug: `duplicate-${suffix}`,
      });
    }, /already exists/);
    assert.ok(created.slug);
  });

  it('updates a custom agent config', () => {
    const created = agentFactory.create({
      userId,
      name: `Updater ${suffix}`,
      specialization: 'Config Updater',
      description: 'update test',
      systemInstructions: 'Initial instructions with no fabrication.',
      toolPermissions: ['knowledge_search'],
    });
    const updated = agentFactory.update({
      userId,
      slug: created.slug,
      config: { specialization: 'Updated Specialization', capabilities: ['reasoning', 'research'] },
    });
    const agent = findAgentBySlug(created.slug);
    assert.equal(updated.status, 'active');
    const config = agent ? JSON.parse(String(agent.config)) as { specialization: string } : null;
    assert.equal(config?.specialization, 'Updated Specialization');
  });
});
