import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  createUser,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
  createCrmContact,
  createCrmPipeline,
  createCrmDeal,
  createCampaign,
  queueCampaignMessage,
  createAutomation,
  createAiEmployee,
  db,
} from './index';
import { verifyWebhookSignature } from '../security/webhooks';

describe('business + auth recovery', () => {
  let userId = '';
  const suffix = randomBytes(4).toString('hex');

  before(() => {
    const user = createUser({ email: `business-${suffix}@akbaral.test`, name: 'Business Test' });
    userId = user.id;
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('creates and verifies auth tokens for password reset / email verification', () => {
    const token = createAuthToken({ userId, purpose: 'password_reset' });
    const verified = verifyAuthToken(token.token, 'password_reset');
    assert.ok(verified);
    assert.equal(verified?.userId, userId);
    consumeAuthToken(verified!.tokenId);
    assert.equal(verifyAuthToken(token.token, 'password_reset'), undefined);
  });

  it('stores CRM contacts, pipelines, deals and campaigns', () => {
    const contact = createCrmContact({ userId, email: `c-${suffix}@example.com`, firstName: 'Ada' });
    const pipeline = createCrmPipeline({ userId, name: 'Sales Pipeline', stages: ['new', 'won'] });
    const deal = createCrmDeal({ userId, title: 'Enterprise deal', pipelineId: pipeline.id, contactId: contact.id, amountCents: 100000, stage: 'new' });
    const campaign = createCampaign({ userId, name: 'Launch email' });
    queueCampaignMessage({ campaignId: campaign.id, userId, channel: 'email', recipient: 'buyer@example.com', subject: 'Hello', body: 'Welcome' });
    const automation = createAutomation({ userId, name: 'Follow up', triggerKey: 'deal.won', steps: [{ action: 'send_email' }] });
    const employee = createAiEmployee({ userId, name: 'Sales Copilot', role: 'sales', agentSlug: null });

    assert.ok(contact.id);
    assert.ok(pipeline.id);
    assert.ok(deal.id);
    assert.ok(campaign.id);
    assert.ok(automation.id);
    assert.ok(employee.id);
  });

  it('verifies webhook signatures time-safely', () => {
    const secret = 'test-secret';
    const payload = JSON.stringify({ event: 'invoice.paid' });
    const signature = `sha256=${require('node:crypto').createHmac('sha256', secret).update(payload).digest('hex')}`;
    assert.equal(verifyWebhookSignature({ payload, signature, secret }), true);
    assert.equal(verifyWebhookSignature({ payload, signature: 'sha256=<bad>', secret }), false);
    assert.equal(verifyWebhookSignature({ payload, signature: undefined, secret }), false);
  });
});
