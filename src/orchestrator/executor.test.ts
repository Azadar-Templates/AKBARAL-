import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  db,
  createUser,
  findTaskById,
  getCreditAccount,
  getAgentExecution,
  listExecutionLogs,
  listTaskEvents,
} from '../db';
import { createResearchTask, runWebResearchExecution } from './executor';
import { startResearchFixture, type ResearchFixtureServer } from '../test-support/research-fixture';

const suffix = randomBytes(6).toString('hex');
const email = `exec-${suffix}@akbaral.test`;
let userId = '';
let fixture: ResearchFixtureServer;

describe('orchestrator + free-task credits', () => {
  before(async () => {
    const user = createUser({ email, name: 'Executor Test User' });
    userId = user.id;
    fixture = await startResearchFixture();
  });

  after(async () => {
    if (fixture) {
      await fixture.close();
    }
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('runs a research task, consumes one credit, and writes logs', async () => {
    const dispatched = createResearchTask({
      userId,
      goal: 'AKBARAL research',
      description: 'verifies Agent #001 and the credit system',
    });

    assert.equal(dispatched.freeCredits, 2);
    assert.equal(getCreditAccount(userId)?.free_credits, 2);

    const result = await runWebResearchExecution(dispatched.executionId);
    assert.equal(result.status, 'completed');

    const task = findTaskById(dispatched.taskId);
    assert.equal(task?.status, 'completed');
    assert.ok(task?.output_data?.includes('AKBARAL'));

    const execution = getAgentExecution(dispatched.executionId);
    assert.equal(execution?.status, 'completed');
    assert.ok((execution?.duration_ms ?? 0) >= 0);

    const logs = listExecutionLogs(dispatched.executionId);
    assert.ok(logs.length >= 3);
    assert.ok(logs.some((log) => (log as { message: string }).message.includes('Planning')));

    const events = listTaskEvents(dispatched.taskId);
    assert.ok(events.some((event) => (event as { message: string }).message.includes('completed successfully')));

    // Credit remains consumed on success.
    assert.equal(getCreditAccount(userId)?.free_credits, 2);
  });

  it('refunds the free credit automatically on failure', async () => {
    const badFixture = await startResearchFixture({ failSearch: true });
    try {
      const dispatched = createResearchTask({ userId, goal: 'failing research' });
      const result = await runWebResearchExecution(dispatched.executionId);
      assert.equal(result.status, 'failed');

      const task = findTaskById(dispatched.taskId);
      assert.equal(task?.status, 'failed');
      assert.ok(task?.error_message);

      const execution = getAgentExecution(dispatched.executionId);
      assert.equal(execution?.status, 'failed');

      const events = listTaskEvents(dispatched.taskId);
      assert.ok(events.some((event) => (event as { message: string }).message.includes('refunded')));

      const account = getCreditAccount(userId);
      // One credit was consumed by the earlier successful task and remains
      // consumed. The failing task's reserved credit was refunded.
      assert.equal(account?.free_credits, 2);
      assert.equal(account?.free_credits_used, 1);
    } finally {
      await badFixture.close();
    }
  });

  it('rejects free tasks when credits are exhausted with requires_pro', async () => {
    db.run(
      `UPDATE credit_accounts SET free_credits = 0, free_credits_used = 99 WHERE user_id = ?`,
      [userId],
    );

    try {
      assert.throws(
        () => createResearchTask({ userId, goal: 'no credits' }),
        (error: Error & { code?: string }) => error.code === 'requires_pro',
      );
    } finally {
      db.run(
        `UPDATE credit_accounts SET free_credits = 3, free_credits_used = 0 WHERE user_id = ?`,
        [userId],
      );
    }
  });
});
