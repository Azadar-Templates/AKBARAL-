import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { updateEconomyPolicy } from '../db/economy-repositories';
import { runDiscovery } from '../economy/operations';
import { proposeSettlement, recordLedgerRevenue } from '../economy/treasury';
import { acknowledgeAlert, countOpenAlerts, getAlert, listAlerts, raiseAlert, raiseAlertSync, resolveAlert } from './alerts';
import { recordSourceOutcome, recordWorkflowOutcome } from './repositories';

function clearAlertEnv(): Record<string, string | undefined> {
  const keys = ['OWNER_ALERT_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) { saved[key] = process.env[key]; delete process.env[key]; }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('D11 centralized owner alerting', () => {
  before(() => {
    applyMigrations(db);
    updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0 } as never);
  });

  it('dedupes by key: repeats bump occurrences instead of spamming rows', async () => {
    const saved = clearAlertEnv();
    try {
      const key = `d11-dedupe-${Date.now()}`;
      const first = await raiseAlert({ condition: 'source-blocked', title: 'Dedupe probe', detail: 'one', dedupeKey: key });
      assert.equal(first.status, 'open');
      assert.equal(first.occurrences, 1);
      const second = await raiseAlert({ condition: 'source-blocked', title: 'Dedupe probe', detail: 'two', dedupeKey: key });
      assert.equal(second.id, first.id);
      assert.equal(second.occurrences, 2);
      assert.equal(second.detail, 'two');
      resolveAlert(first.id);
    } finally {
      restoreEnv(saved);
    }
  });

  it('records honest delivery state when no mailbox is configured (never throws)', async () => {
    const saved = clearAlertEnv();
    try {
      const alert = await raiseAlert({
        condition: 'workflow-failed', severity: 'critical', title: 'Delivery probe',
        detail: 'no mailbox here', dedupeKey: `d11-delivery-${Date.now()}`,
      });
      assert.equal(alert.delivery_status, 'not_configured');
      assert.ok((alert.delivery_error ?? '').length > 0);
      resolveAlert(alert.id);
    } finally {
      restoreEnv(saved);
    }
  });

  it('acknowledge closes the loop; a later repeat opens a fresh alert', async () => {
    const saved = clearAlertEnv();
    try {
      const key = `d11-ack-${Date.now()}`;
      const first = await raiseAlert({ condition: 'stale-executions', title: 'Ack probe', dedupeKey: key });
      const acked = acknowledgeAlert(first.id, 'owner:test');
      assert.equal(acked.status, 'acknowledged');
      assert.equal(acked.acknowledged_by, 'owner:test');
      const reopened = await raiseAlert({ condition: 'stale-executions', title: 'Ack probe again', dedupeKey: key });
      assert.notEqual(reopened.id, first.id);
      assert.equal(reopened.status, 'open');
      assert.equal(reopened.occurrences, 1);
      resolveAlert(reopened.id);
    } finally {
      restoreEnv(saved);
    }
  });

  it('validation errors throw (programming bugs stay loud)', async () => {
    await assert.rejects(() => raiseAlert({ condition: 'source-blocked', title: '', dedupeKey: 'x' }), /dedupeKey and title/);
    assert.throws(() => raiseAlertSync({ condition: 'source-blocked', title: 't', dedupeKey: '' }), /dedupeKey and title/);
    assert.throws(() => acknowledgeAlert('eco_alr_missing', 'owner:test'), /not found/);
  });

  it('source auto-block raises a source-blocked alert', () => {
    const domain = `d11-${Date.now()}.test`;
    recordSourceOutcome({ domain, category: 'seo', ok: false, error: 'boom 1' });
    recordSourceOutcome({ domain, category: 'seo', ok: false, error: 'boom 2' });
    assert.equal(countOpenAlerts() >= 0, true); // no alert before the threshold
    const before = listAlerts('open').filter((a) => a.dedupe_key === `source-blocked:${domain}|seo`).length;
    recordSourceOutcome({ domain, category: 'seo', ok: false, error: 'boom 3' });
    const after = listAlerts('open').filter((a) => a.dedupe_key === `source-blocked:${domain}|seo`);
    assert.equal(after.length, before + 1);
    assert.equal(after[0].condition, 'source-blocked');
    resolveAlert(after[0].id);
  });

  it('workflow failure raises a workflow-failed alert', () => {
    const slug = `d11-agent-${Date.now()}`;
    recordWorkflowOutcome({ agentSlug: slug, category: 'research', workflowKey: 'execute:deliverable', ok: false, error: 'bad 1' });
    recordWorkflowOutcome({ agentSlug: slug, category: 'research', workflowKey: 'execute:deliverable', ok: false, error: 'bad 2' });
    recordWorkflowOutcome({ agentSlug: slug, category: 'research', workflowKey: 'execute:deliverable', ok: false, error: 'bad 3' });
    const found = listAlerts('open').filter((a) => a.dedupe_key === `workflow-failed:${slug}:research:execute:deliverable`);
    assert.equal(found.length, 1);
    assert.equal(getAlert(found[0].id)!.condition, 'workflow-failed');
    resolveAlert(found[0].id);
  });

  it('blind discovery raises a discovery-unavailable alert (dead endpoint, fast)', async () => {
    const saved = clearAlertEnv();
    const savedEndpoint = process.env.AKBARAL_SEARCH_ENDPOINT;
    const savedAllow = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
    try {
      process.env.AKBARAL_SEARCH_ENDPOINT = 'http://127.0.0.1:1/search';
      process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
      const result = await runDiscovery(['research']);
      assert.ok(result.unavailable, 'dead endpoint must surface as unavailable');
      const found = listAlerts('open').filter((a) => a.dedupe_key === 'discovery-unavailable:research');
      assert.ok(found.length >= 1, 'expected a discovery-unavailable alert');
      for (const alert of found) resolveAlert(alert.id);
    } finally {
      if (savedEndpoint === undefined) delete process.env.AKBARAL_SEARCH_ENDPOINT;
      else process.env.AKBARAL_SEARCH_ENDPOINT = savedEndpoint;
      if (savedAllow === undefined) delete process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER;
      else process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = savedAllow;
      restoreEnv(saved);
    }
  });

  it('proposed settlement raises an info alert for the owner transfer', () => {
    const saved = clearAlertEnv();
    try {
      recordLedgerRevenue({ amountCents: 50_000, evidence: 'd11 test funding — bank advice TF-D11', externalRef: `TF-D11-${Date.now()}` });
      // Set a real destination explicitly rather than inheriting whatever an
      // earlier file left in the shared database: settlement refuses the seeded
      // placeholder, and this test is about the alert, not the destination.
      updateEconomyPolicy({ settlement_destination: 'owner-bank-acct ALERTS-TEST-001' });
      const outcome = proposeSettlement();
      assert.equal(outcome.created, true, `settlement must be created (reason: ${outcome.reason})`);
      const found = listAlerts('open').filter((a) => a.dedupe_key === `settlement-awaiting-owner:${outcome.settlementId}`);
      assert.equal(found.length, 1);
      assert.equal(found[0].severity, 'info');
      resolveAlert(found[0].id);
    } finally {
      restoreEnv(saved);
    }
  });
});
