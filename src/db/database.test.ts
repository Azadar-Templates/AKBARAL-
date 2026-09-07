import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  db,
  createUser,
  findUserById,
  getCreditAccount,
  consumeFreeCredit,
  refundCredit,
  listCreditTransactions,
  createProject,
  createAgentCategory,
  createAgent,
  findAgentBySlug,
  createTask,
  findTaskById,
  createAgentExecution,
  updateAgentExecutionStatus,
  appendAgentExecutionLog,
  listExecutionLogs,
  appendTaskEvent,
  createToolIntegration,
  linkAgentIntegration,
  recordUsage,
  appendAuditLog,
  appendSecurityLog,
  createSession,
  createApiKey,
} from './index';

const suffix = randomBytes(6).toString('hex');
const email = `test-${suffix}@akbaral.test`;

describe('database foundation', () => {
  let userId: string;
  let projectId: string;
  let categoryId: string;
  let agentId: string;
  let taskId: string;
  let executionId: string;
  let integrationId: string;

  before(() => {
    const user = createUser({
      email,
      name: 'Phase 1 Test User',
      role: 'user',
      status: 'active',
      passwordHash: '$2b$10$fakehashonlyforfoundationtest',
    });
    userId = user.id;

    const project = createProject({
      ownerId: userId,
      name: `Test Project ${suffix}`,
      slug: `test-project-${suffix}`,
    });
    projectId = project.id;

    const category = createAgentCategory({
      name: `Test Category ${suffix}`,
      slug: `test-category-${suffix}`,
    });
    categoryId = category.id;

    const agent = createAgent({
      name: `Test Agent ${suffix}`,
      slug: `test-agent-${suffix}`,
      categoryId,
      ownerId: userId,
      projectId,
      status: 'active',
    });
    agentId = agent.id;

    const task = createTask({
      userId,
      title: `Test Task ${suffix}`,
      projectId,
      agentId,
      inputData: { query: 'hello world' },
      type: 'free',
    });
    taskId = task.id;

    const consumed = consumeFreeCredit({
      userId,
      taskId,
      reason: 'foundation test consume',
    });
    assert.ok(consumed, 'free credit consumption should succeed');

    const refund = refundCredit({
      userId,
      taskId,
      reason: 'foundation test refund',
    });
    assert.ok(refund, 'free credit refund should succeed');

    const execution = createAgentExecution({
      agentId,
      taskId,
      inputData: { query: 'hello world' },
    });
    executionId = execution.id;

    updateAgentExecutionStatus({
      id: executionId,
      status: 'completed',
      durationMs: 12,
      outputData: { answer: 'ok' },
    });
    appendAgentExecutionLog({
      executionId,
      message: 'execution finished',
      level: 'info',
    });
    appendTaskEvent({
      taskId,
      executionId,
      message: 'task queued',
      level: 'info',
      type: 'status',
    });

    const integration = createToolIntegration({
      name: `Test Integration ${suffix}`,
      type: 'api',
      userId,
      projectId,
      scopes: 'read',
    });
    integrationId = integration.id;

    linkAgentIntegration({
      agentId,
      integrationId,
      scope: 'read',
    });

    recordUsage({
      userId,
      projectId,
      taskId,
      agentId,
      executionId,
      metric: 'tokens_in',
      value: 128,
      unit: 'tokens',
    });

    appendAuditLog({
      actorId: userId,
      action: 'task.created',
      resourceType: 'task',
      resourceId: taskId,
    });
    appendSecurityLog({
      userId,
      eventType: 'auth.login.success',
      severity: 'info',
    });
    createSession({
      userId,
      tokenHash: `session-test-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    createApiKey({
      userId,
      name: `Test Key ${suffix}`,
      keyPrefix: `akb_${suffix}`,
      keyHash: `hash_${suffix}`,
    });
  });

  after(() => {
    // Remove children in dependency-safe order before deleting the user.
    db.run('DELETE FROM agent_integrations WHERE agent_id = ? OR integration_id = ?', [agentId, integrationId]);
    db.run('DELETE FROM tool_integrations WHERE user_id = ?', [userId]);
    db.run('DELETE FROM agents WHERE owner_id = ?', [userId]);
    db.run('DELETE FROM projects WHERE owner_id = ?', [userId]);
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.run('DELETE FROM agent_categories WHERE id = ?', [categoryId]);
    db.close();
  });

  it('creates a user with a default free-credit account', () => {
    const user = findUserById(userId);
    assert.ok(user);
    assert.equal(user.email, email);
    assert.equal(user.role, 'user');

    const account = getCreditAccount(userId);
    assert.ok(account);
    assert.equal(account.free_credits, 3);
    assert.equal(account.free_credits_used, 0);
  });

  it('consumes and automatically refunds a free task credit', () => {
    const transactions = listCreditTransactions(userId);
    assert.equal(transactions.length, 2);

    const consume = transactions.find((transaction) => transaction.type === 'consume_task');
    const refund = transactions.find((transaction) => transaction.type === 'refund_task');
    assert.ok(consume);
    assert.ok(refund);
    assert.equal(consume.amount, -1);
    assert.equal(refund.amount, 1);

    const account = getCreditAccount(userId);
    assert.equal(account?.free_credits, 3);
    assert.equal(account?.free_credits_used, 0);
  });

  it('persists tasks and execution logs with relations', () => {
    const task = findTaskById(taskId);
    assert.ok(task);
    assert.equal(task.title, `Test Task ${suffix}`);
    assert.equal(task.status, 'created');
    assert.equal(task.agent_id, agentId);
    assert.equal(task.project_id, projectId);

    const logs = listExecutionLogs(executionId);
    assert.equal(logs.length, 1);

    const events = db.all<{ message: string }>(
      'SELECT message FROM task_events WHERE task_id = ?',
      [taskId],
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].message, 'task queued');
  });

  it('registers an agent with its category', () => {
    const agent = findAgentBySlug(`test-agent-${suffix}`);
    assert.ok(agent);
    assert.equal(agent.category_id, categoryId);
    assert.equal(agent.owner_id, userId);
  });

  it('records usage, audit and security events', () => {
    const usage = db.get<{ metric: string; value: number }>(
      'SELECT metric, value FROM usage_records WHERE task_id = ?',
      [taskId],
    );
    assert.equal(usage?.metric, 'tokens_in');
    assert.equal(usage?.value, 128);

    const audit = db.get<{ action: string }>(
      'SELECT action FROM audit_logs WHERE actor_id = ?',
      [userId],
    );
    assert.equal(audit?.action, 'task.created');

    const security = db.get<{ event_type: string }>(
      'SELECT event_type FROM security_logs WHERE user_id = ?',
      [userId],
    );
    assert.equal(security?.event_type, 'auth.login.success');
  });
});
