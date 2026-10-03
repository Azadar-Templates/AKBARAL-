import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReadiness, READINESS_STATUSES } from './readiness-status';

describe('canonical readiness transitions', () => {
  it('publishes exactly four readiness states', () => {
    assert.deepEqual(READINESS_STATUSES, ['WORK-READY', 'CONDITIONAL', 'DEGRADED', 'NOT_READY']);
  });

  it('maps legacy operational states without inflating readiness', () => {
    assert.equal(normalizeReadiness('ACTIVE'), 'WORK-READY');
    assert.equal(normalizeReadiness('READY'), 'WORK-READY');
    assert.equal(normalizeReadiness('NEEDS_CONFIGURATION'), 'CONDITIONAL');
    assert.equal(normalizeReadiness('NEEDS_OWNER_ACTION'), 'CONDITIONAL');
    assert.equal(normalizeReadiness('PARTIALLY_READY'), 'CONDITIONAL');
    assert.equal(normalizeReadiness('MISSING_DEPENDENCY'), 'DEGRADED');
    assert.equal(normalizeReadiness('DEGRADED'), 'DEGRADED');
    assert.equal(normalizeReadiness('BLOCKED'), 'NOT_READY');
    assert.equal(normalizeReadiness('FAILED'), 'NOT_READY');
    assert.equal(normalizeReadiness('NOT_READY'), 'NOT_READY');
  });
});
