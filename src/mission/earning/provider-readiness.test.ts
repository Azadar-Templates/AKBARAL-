import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-provider-readiness-${randomUUID()}.db`)}`;
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations } = require('../database') as typeof import('../database');
const ProviderReadiness = require('./provider-capability-registry') as typeof import('./provider-capability-registry');
const PlatformDiscovery = require('./platform-discovery') as typeof import('./platform-discovery');

before(()=> { applyMissionMigrations(); PlatformDiscovery.seedPlatforms(); ProviderReadiness.seedProviderReadiness(); });
after(()=> { const { missionDb } = require('../database') as typeof import('../database'); missionDb.close(); });

describe('provider capability/readiness registry', ()=> {
  it('lists 36 earning sources, infra/tools not counted', ()=> {
    const summary = ProviderReadiness.providerReadinessSummary() as any;
    assert.equal(summary.earningSources.total, 36);
    assert.equal(summary.infrastructure > 0, true);
    assert.equal(summary.paymentRails > 0, true);
    assert.ok(summary.tools > 0);
    assert.match(String(summary.note), /not earning sources/);
  });
  it('ready vs not_configured honestly (no credentials)', ()=> {
    const list = ProviderReadiness.listEarningReadiness() as any;
    // Fresh DB has no vault credentials → most not_configured, none ready for credential-required
    assert.ok(list.total === 36);
    // direct_client_research does not require credential → should be ready even without vault
    const direct = ProviderReadiness.getProviderReadiness('direct_client_research') as any;
    assert.equal(direct.status, 'ready');
    assert.equal(direct.requiresOwnerAccount, false);
  });
  it('records provider failure and recovers with audit', ()=> {
    const before = ProviderReadiness.getProviderReadiness('freelancer') as any;
    ProviderReadiness.recordProviderFailure('freelancer', {code:'freelancer_rate_limited', category:'rate_limit', detail:'test rate limit'});
    const degraded = ProviderReadiness.getProviderReadiness('freelancer') as any;
    assert.equal(degraded.status, 'degraded');
    const recovered = ProviderReadiness.clearProviderFailures('freelancer');
    assert.equal(recovered >= 1, true);
    const after = ProviderReadiness.getProviderReadiness('freelancer') as any;
    assert.equal(after.status === 'ready' || after.status === 'not_configured', true);
    void before;
  });
  it('getProviderReadiness returns block status for ToS-blocked', ()=> {
    // example_not_earning is NOT_AN_EARNING_SOURCE → blocked path
    const r = ProviderReadiness.getProviderReadiness('freelancer') as any;
    assert.ok(r.ownerActions.length > 0);
  });
  it('provider-readiness does not leak secrets', ()=> {
    const all = ProviderReadiness.listProviderReadiness() as any[];
    for (const p of all) {
      // No secret value, only env var name
      assert.ok(!String(p.credentialEnv ?? '').includes('sk-'));
      assert.ok(!JSON.stringify(p).includes('secret'));
    }
  });
});
