import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  createFeedback,
  createTask,
  createUser,
  db,
  findTaskRating,
  getAvailableCreditsForUser,
  grantCustomCredits,
  listFeedbackForAdmin,
  listUserFeedback,
  refundTaskCredit,
  consumeTaskCredit,
  updateFeedbackStatus,
  upsertTaskRating,
  getCreditAccount,
} from './index';

const suffix = randomBytes(6).toString('hex');
const email = `trust-${suffix}@akbaral.test`;

describe('trust, feedback and paid-credit accounting', () => {
  let userId = '';
  let taskId = '';

  before(() => {
    const user = createUser({ email, name: 'Trust Test User' });
    userId = user.id;
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('uses paid credits first and refunds to the same pool', () => {
    db.run('UPDATE credit_accounts SET free_credits = 0, free_credits_used = 0 WHERE user_id = ?', [userId]);
    grantCustomCredits({ userId, amount: 3, reason: 'paid credit test' });
    assert.equal(getAvailableCreditsForUser(userId), 3);

    const taskA = createTask({ userId, title: `paid-a-${suffix}`, type: 'paid' });
    const taskB = createTask({ userId, title: `paid-b-${suffix}`, type: 'paid' });
    const consumedA = consumeTaskCredit({ userId, taskId: taskA.id, reason: 'paid test a' });
    const consumedB = consumeTaskCredit({ userId, taskId: taskB.id, reason: 'paid test b' });
    assert.ok(consumedA);
    assert.ok(consumedB);
    assert.equal(String(consumedA.reference), 'paid');
    assert.equal(String(consumedB.reference), 'paid');

    const account = getCreditAccount(userId);
    assert.equal(account?.paid_credits, 1);
    assert.equal(getAvailableCreditsForUser(userId), 1);

    const refunded = refundTaskCredit({ userId, taskId: taskB.id, reason: 'paid refund test' });
    assert.ok(refunded);
    const afterRefund = getCreditAccount(userId);
    assert.equal(afterRefund?.paid_credits, 2);
    assert.equal(getAvailableCreditsForUser(userId), 2);
  });

  it('cannot double-spend the final credit', () => {
    db.run('UPDATE credit_accounts SET free_credits = 0, paid_credits = 1, bonus_credits = 0, free_credits_used = 0 WHERE user_id = ?', [userId]);
    const results = [1, 2, 3].map((n) => consumeTaskCredit({
      userId,
      taskId: createTask({ userId, title: `race-${suffix}-${n}`, type: 'paid' }).id,
      reason: `race ${n}`,
    }));
    const success = results.filter(Boolean);
    assert.equal(success.length, 1);
    assert.equal(getAvailableCreditsForUser(userId), 0);
    db.run('UPDATE credit_accounts SET paid_credits = 0 WHERE user_id = ?', [userId]);
  });

  it('stores user ratings, feedback and admin moderation', () => {
    const task = createTask({ userId, title: `rating-${suffix}`, type: 'paid' });
    taskId = task.id;
    const rating = upsertTaskRating({ userId, taskId, rating: 5, comment: 'excellent' });
    assert.equal(rating.rating, 5);
    const stored = findTaskRating(taskId);
    assert.ok(stored);
    assert.equal(stored.rating, 5);

    const feedback = createFeedback({ userId, type: 'feature', subject: 'More plan choices', body: 'Please add a team plan.' });
    assert.equal(feedback.status, 'open');
    const mine = listUserFeedback(userId);
    assert.ok(mine.some((row) => String(row.id) === feedback.id));
    const admin = listFeedbackForAdmin();
    assert.ok(admin.some((row) => String(row.id) === feedback.id));
    updateFeedbackStatus({ feedbackId: feedback.id, status: 'resolved', adminUserId: userId, adminNote: 'accepted' });
    const after = listUserFeedback(userId).find((row) => String(row.id) === feedback.id);
    assert.equal(after?.status, 'resolved');
  });
});
