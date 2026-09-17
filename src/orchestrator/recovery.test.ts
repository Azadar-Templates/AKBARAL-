import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  db,
  createUser,
  getCreditAccount,
  findTaskById,
  getWorkflow,
  listWorkflowSteps,
} from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { createAgentTask } from './executor';
import { createExecutionPlan } from './planner';
import { recoverInterruptedWork } from './recovery';

/**
 * Crash recovery test.
 *
 * Simulates a process dying mid-run by creating tasks/workflows and marking
 * them running WITHOUT executing them (exactly the state a crash leaves
 * behind), then verifies the boot reconciliation fails them honestly and
 * refunds every reserved credit exactly once.
 */

const suffix = randomBytes(6).toString('hex');
const email = `recovery-${suffix}@akbaral.test`;
let userId = '';

describe('crash recovery', () => {
  before(() => {
    syncAgentRegistry();
    const user = createUser({ email, name: 'Recovery Test' });
    userId = user.id;
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('fails interrupted tasks/workflows and refunds reserved credits exactly once', () => {
    // Simulate a crash mid-run: two agent tasks created (credits consumed)
    // but never executed, plus a running workflow graph.
    const dispatchedA = createAgentTask({ userId, agentSlug: 'research-researcher-002', goal: 'crash test alpha' });
    createAgentTask({ userId, agentSlug: 'research-investigator-016', goal: 'crash test beta' });
    assert.equal(getCreditAccount(userId)?.free_credits, 3, 'two credits reserved');

    const planned = createExecutionPlan({ userId, goal: 'crash test workflow' });
    db.run(`UPDATE workflows SET status='running' WHERE id = ?`, [planned.workflowId]);
    const steps = listWorkflowSteps(planned.workflowId);
    db.run(`UPDATE workflow_steps SET status='running' WHERE id = ?`, [String(steps[0].id)]);
    // Link one dispatched task into a running execution to cover that layer.
    db.run(`UPDATE agent_executions SET status='running' WHERE id = ?`, [dispatchedA.executionId]);

    const report = recoverInterruptedWork();
    // Other test files may leave their own non-terminal rows in this shared
    // test database; assert this suite's items were all reconciled.
    assert.ok(report.tasks >= 2, `expected >= 2 tasks reconciled, got ${report.tasks}`);
    assert.ok(report.workflows >= 1);
    assert.ok(report.steps >= 1);
    // Both dispatched tasks left orphaned executions behind (one running,
    // one still queued from creation).
    assert.ok(report.executions >= 2);
    assert.ok(report.creditsRefunded >= 2);

    // Honest failure states.
    const taskA = findTaskById(dispatchedA.taskId);
    assert.equal(taskA?.status, 'failed');
    assert.equal(taskA?.error_message, 'interrupted by server restart');
    const workflow = getWorkflow(planned.workflowId);
    assert.equal(workflow?.status, 'failed');
    assert.equal(workflow?.error_message, 'interrupted by server restart');
    const step = listWorkflowSteps(planned.workflowId)[0];
    assert.equal(step.status, 'failed');

    // Trust policy: both credits restored.
    assert.equal(getCreditAccount(userId)?.free_credits, 5);

    // Idempotent: a second boot pass finds nothing and refunds nothing.
    const second = recoverInterruptedWork();
    assert.equal(second.tasks, 0);
    assert.equal(second.creditsRefunded, 0);
    assert.equal(getCreditAccount(userId)?.free_credits, 5);
  });

  it('leaves completed work untouched', () => {
    const dispatched = createAgentTask({ userId, agentSlug: 'research-researcher-002', goal: 'finished before crash' });
    db.run(`UPDATE tasks SET status='completed', completed_at=? WHERE id = ?`, [new Date().toISOString(), dispatched.taskId]);
    const before = getCreditAccount(userId)?.free_credits;
    const report = recoverInterruptedWork();
    // This suite's completed task must not be refunded; other suites' rows
    // may be reconciled by the same pass.
    const task = findTaskById(dispatched.taskId);
    assert.equal(task?.status, 'completed', 'completed tasks are never failed by recovery');
    assert.equal(getCreditAccount(userId)?.free_credits, before, 'completed tasks are never refunded by recovery');
    assert.ok(report.tasks >= 0);
  });
});
