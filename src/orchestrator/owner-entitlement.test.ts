import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, createUser, findTaskById, getCreditAccount, listTasksByUser } from '../db';
import { createAutomationRow, listAutomationRunRows } from '../db/automation-repositories';
import { syncAgentRegistry } from '../agents/registry';
import { createResearchTask, WEB_RESEARCH_AGENT_SLUG } from './executor';
import { automationScheduler } from '../automation/scheduler';
import { hasUnlimitedTaskCredits } from '../auth/entitlements';

/**
 * Owner / super_admin unlimited-execution entitlement — regression lock.
 *
 * The entitlement is enforced server-side, so it has to hold at BOTH gates that
 * inspect the credit balance:
 *
 *   1. The orchestrator pre-flight (`createResearchTask` / `createAgentTask`)
 *      must not refuse a zero-balance owner with `requires_pro` before the
 *      reservation point (which is where the role is honoured) is reached.
 *   2. The automation scheduler must not auto-pause or refuse an owner's
 *      automations for "no task credits remaining".
 *
 * Normal users must keep exactly the previous accounting: consume one credit
 * per successful execution, `requires_pro` when nothing is left. These tests
 * assert both directions so the owner bypass can never silently widen into the
 * normal-user path.
 */

const suffix = randomBytes(6).toString('hex');
const ownerEmail = `owner-ent-${suffix}@akbaral.test`;
const adminEmail = `super-ent-${suffix}@akbaral.test`;
const userEmail = `normal-ent-${suffix}@akbaral.test`;

let ownerId = '';
let superAdminId = '';
let userId = '';

function drainCredits(id: string): void {
  db.run(
    `UPDATE credit_accounts SET free_credits = 0, paid_credits = 0, bonus_credits = 0 WHERE user_id = ?`,
    [id],
  );
}

function availableCredits(id: string): number {
  const account = getCreditAccount(id);
  return Number(account?.free_credits ?? 0) + Number(account?.paid_credits ?? 0) + Number(account?.bonus_credits ?? 0);
}

before(() => {
  syncAgentRegistry();
  ownerId = createUser({ email: ownerEmail, name: 'Owner Entitlement', role: 'owner', freeCredits: 0 }).id;
  superAdminId = createUser({ email: adminEmail, name: 'Super Admin Entitlement', role: 'super_admin', freeCredits: 0 }).id;
  userId = createUser({ email: userEmail, name: 'Normal Entitlement' }).id;
  drainCredits(ownerId);
  drainCredits(superAdminId);
});

after(() => {
  for (const id of [ownerId, superAdminId, userId]) {
    if (!id) {
      continue;
    }
    db.run('DELETE FROM automation_runs WHERE automation_id IN (SELECT id FROM automations WHERE user_id = ?)', [id]);
    db.run('DELETE FROM automations WHERE user_id = ?', [id]);
    db.run('DELETE FROM credit_transactions WHERE user_id = ?', [id]);
    db.run('DELETE FROM users WHERE id = ?', [id]);
  }
  db.close();
});

describe('owner unlimited execution: orchestrator credit gate', () => {
  it('allows an owner with zero credits to dispatch, consuming nothing', () => {
    assert.equal(hasUnlimitedTaskCredits(ownerId), true, 'owner is entitled');
    assert.equal(availableCredits(ownerId), 0, 'owner really has no credits');

    const dispatched = createResearchTask({ userId: ownerId, goal: 'Owner launch verification task' });

    assert.ok(dispatched.taskId, 'task created for the owner');
    const task = findTaskById(dispatched.taskId);
    assert.ok(task, 'task row persisted');
    // 'created' at dispatch time; the durable queue flips it to 'queued'.
    assert.ok(['created', 'queued'].includes(String(task.status)), `task dispatched (status ${task.status})`);
    assert.equal(dispatched.freeCredits, 0, 'owner balance reported unchanged');
    assert.equal(availableCredits(ownerId), 0, 'no credit consumed by owner execution');

    const audit = db.get<{ action: string }>(
      `SELECT action FROM audit_logs WHERE actor_id = ? AND action = 'owner.unlimited_execution' AND resource_id = ?`,
      [ownerId, dispatched.taskId],
    );
    assert.ok(audit, 'unlimited owner execution is audited');
  });

  it('allows a super_admin with zero credits to dispatch', () => {
    assert.equal(hasUnlimitedTaskCredits(superAdminId), true, 'super_admin is entitled');
    const dispatched = createResearchTask({ userId: superAdminId, goal: 'Super admin launch verification task' });
    assert.ok(dispatched.taskId, 'task created for super_admin');
    assert.equal(availableCredits(superAdminId), 0, 'no credit consumed by super_admin execution');
  });

  it('still refuses a normal user with zero credits (requires_pro)', () => {
    drainCredits(userId);
    assert.equal(hasUnlimitedTaskCredits(userId), false, 'normal user is not entitled');
    assert.throws(
      () => createResearchTask({ userId, goal: 'normal user with no credits' }),
      (error: Error & { code?: string }) => error.code === 'requires_pro',
    );
    const tasks = listTasksByUser(userId, { limit: 50, offset: 0 })
      .filter((task) => String(task.title) === 'normal user with no credits');
    assert.equal(tasks.length, 0, 'no task row is created when the credit is unavailable');
    assert.equal(availableCredits(userId), 0, 'balance untouched');
  });

  it('still consumes exactly one credit for a normal user execution', () => {
    db.run(`UPDATE credit_accounts SET free_credits = 2, free_credits_used = 0 WHERE user_id = ?`, [userId]);
    const dispatched = createResearchTask({ userId, goal: 'normal user paid execution' });
    assert.equal(dispatched.freeCredits, 1, 'exactly one credit consumed');
    assert.equal(availableCredits(userId), 1);

    const second = createResearchTask({ userId, goal: 'normal user second execution' });
    assert.equal(second.freeCredits, 0, 'second execution consumes the last credit');
    assert.throws(
      () => createResearchTask({ userId, goal: 'normal user third execution' }),
      (error: Error & { code?: string }) => error.code === 'requires_pro',
    );
  });
});

describe('owner unlimited execution: automation scheduler gate', () => {
  function automationFor(userIdForAutomation: string, name: string): ReturnType<typeof createAutomationRow> {
    return createAutomationRow({
      userId: userIdForAutomation,
      name,
      description: null,
      scheduleJson: JSON.stringify({ kind: 'interval', seconds: 3600 }),
      conditionJson: null,
      stepsJson: JSON.stringify([{ agentSlug: WEB_RESEARCH_AGENT_SLUG, goal: 'Scheduled verification', toolKey: null }]),
      timeoutMs: 60_000,
      maxRetries: 0,
      nextRunAt: null,
    });
  }

  it('does not auto-pause or refuse an owner whose credits are exhausted', () => {
    drainCredits(ownerId);
    const automation = automationFor(ownerId, `owner-automation-${suffix}`);
    const run = automationScheduler.triggerManualRun(automation);

    assert.ok(run?.id, 'manual run accepted for the owner');
    assert.equal(availableCredits(ownerId), 0, 'owner run consumes no credits');
    assert.equal(String(db.get<{ status: string }>('SELECT status FROM automations WHERE id = ?', [automation.id])!.status), 'active', 'owner automation stays active');
    assert.ok(listAutomationRunRows(automation.id, 5).length >= 1, 'run row persisted');
  });

  it('still refuses a normal user automation with zero credits', () => {
    drainCredits(userId);
    const automation = automationFor(userId, `normal-automation-${suffix}`);
    assert.throws(
      () => automationScheduler.triggerManualRun(automation),
      (error: Error & { code?: string }) => error.code === 'requires_pro',
    );
    assert.equal(listAutomationRunRows(automation.id, 5).length, 0, 'no run row for the refused trigger');
  });
});

describe('entitlement helper', () => {
  it('reports entitlement per role and defaults safely for unknown users', () => {
    // A user row for a registered owner or admin is entitled; a plain user and
    // an unknown id are not (least privilege by default).
    assert.equal(hasUnlimitedTaskCredits(ownerId), true);
    assert.equal(hasUnlimitedTaskCredits(superAdminId), true);
    assert.equal(hasUnlimitedTaskCredits(userId), false);
    assert.equal(hasUnlimitedTaskCredits('usr_does_not_exist'), false);
    assert.equal(hasUnlimitedTaskCredits(''), false);
  });
});
