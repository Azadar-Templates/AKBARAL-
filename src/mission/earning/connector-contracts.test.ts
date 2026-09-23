import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-contracts-${randomUUID()}.db`)}`;
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations } = require('../database') as typeof import('../database');
const Contracts = require('./connector-execution-contracts') as typeof import('./connector-execution-contracts');

before(()=> { applyMissionMigrations(); });
after(()=> { const { missionDb } = require('../database') as typeof import('../database'); missionDb.close(); });

describe('connector execution contracts', ()=> {
  it('seeds 34 permitted earning contracts, infra has no contract', ()=> {
    const seeded = Contracts.seedConnectorContracts();
    // first run seeds, second idempotent
    assert.ok(seeded >= 0);
    const all = Contracts.listConnectorContracts() as any[];
    assert.equal(all.length, 34);
    assert.ok(!all.some(c=> c.connectorId==='github'));
    assert.ok(!all.some(c=> c.connectorId==='stripe'));
  });
  it('contract has required fields and valid error map', ()=> {
    const c = Contracts.getConnectorContract('freelancer') as any;
    assert.ok(c);
    assert.equal(c.connectorId, 'freelancer');
    assert.ok(c.executionInputSchema.required.includes('opportunityId'));
    assert.ok(c.executionOutputSchema.required.includes('evidenceHash'));
    assert.match(c.idempotencyKeyTemplate, /opportunityId/);
    assert.ok(c.rateLimitPerMin >= 2);
    assert.ok(c.maxRetries >= 1);
    assert.ok(c.backoffBaseMs >= 30000);
    assert.ok(c.auditEvents.length > 0);
  });
  it('classifies provider errors per contract', ()=> {
    assert.equal(Contracts.classifyProviderError('freelancer','freelancer_rate_limited'), 'rate_limit');
    assert.equal(Contracts.classifyProviderError('freelancer','freelancer_access_denied'), 'auth');
    assert.equal(Contracts.classifyProviderError('awin','awin_http_failure'), 'transient');
    assert.equal(Contracts.classifyProviderError('freelancer','unknown_code'), 'transient');
  });
  it('idempotency key template is deterministic and bounded', ()=> {
    const c = Contracts.getConnectorContract('direct_client_research') as any;
    const k1 = Contracts.idempotencyKeyFor(c, {opportunityId:'opp1', agentId:'agt1', scopeHash:'abc123'});
    const k2 = Contracts.idempotencyKeyFor(c, {opportunityId:'opp1', agentId:'agt1', scopeHash:'abc123'});
    assert.equal(k1, k2);
    assert.ok(k1.length <= 240);
  });
  it('humanOnly flag blocks autonomous execution', ()=> {
    const toptal = Contracts.getConnectorContract('toptal') as any;
    assert.equal(toptal.humanOnly, true);
    const direct = Contracts.getConnectorContract('direct_client_research') as any;
    assert.equal(direct.humanOnly, false);
  });
});
