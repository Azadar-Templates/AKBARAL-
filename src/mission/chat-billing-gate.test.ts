/**
 * Tests for the chat dispatch billing gate.
 *
 * Two things are under test:
 *  1. the gate now permits a genuinely $0 free tier (so the mission can think
 *     under the $0-upfront constraint) while keeping paid dispatch fail-closed;
 *  2. the gate can no longer be bypassed by wrapping the adapter — which is how
 *     the production worker actually invoked it, meaning the gate was
 *     previously skipped in the only place it mattered.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.ZA141251SA_CREDENTIAL_KEY ??= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
process.env.ZA141251SA_SESSION_SECRET ??= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
process.env.ZA141251SA_DATABASE_URL ??= ':memory:';

const {
  assertVerifiedChatBillingConfigured,
  chatDispatchReadiness,
  isLiveChatAdapter,
  markLiveChatAdapter,
  invokeGoogleChat,
  FREE_TIER_MODELS,
} = require('./chat-provider') as typeof import('./chat-provider');
const { CHAT_MODEL } = require('./chat-state') as typeof import('./chat-state');

const FREE_CONFIG = { model: CHAT_MODEL, costBasis: 'Google AI Studio free tier, no cash may be spent' } as const;
const OPTED_IN = { ZA141251SA_CHAT_FREE_TIER: 'true' };

describe('chat billing gate — paid dispatch stays fail-closed', () => {
  it('blocks dispatch by default, with no opt-in', () => {
    assert.throws(
      () => assertVerifiedChatBillingConfigured(FREE_CONFIG, {}),
      /verified vendor billing adapter is required/,
    );
  });

  it('blocks a model that is not on the free tier even when opted in', () => {
    assert.throws(
      () => assertVerifiedChatBillingConfigured({ model: 'gemini-2.5-pro' as never, costBasis: 'free tier' }, OPTED_IN),
      /not on the permitted \$0 free tier/,
    );
  });

  it('blocks a cost basis that does not record the free tier', () => {
    assert.throws(
      () => assertVerifiedChatBillingConfigured({ model: CHAT_MODEL, costBasis: 'owner prepaid credit of $50' } as const, OPTED_IN),
      /free tier/i,
    );
  });

  it('requires the configuration to be supplied; opt-in alone is not enough', () => {
    assert.throws(() => assertVerifiedChatBillingConfigured(undefined, OPTED_IN), /configuration to be supplied/);
  });
});

describe('chat billing gate — the $0 free tier is reachable', () => {
  it('permits dispatch when opted in on a free-tier model with a free-tier cost basis', () => {
    assert.doesNotThrow(() => assertVerifiedChatBillingConfigured(FREE_CONFIG, OPTED_IN));
  });

  it('lists the configured chat model as the free-tier model', () => {
    assert.ok(FREE_TIER_MODELS.includes(CHAT_MODEL));
  });

  it('reports blocked readiness with exact owner actions when not opted in', () => {
    const readiness = chatDispatchReadiness({});
    assert.equal(readiness.dispatchable, false);
    assert.equal(readiness.mode, 'blocked');
    assert.ok(readiness.ownerActions.some(a => /free Google AI Studio API key/i.test(a)));
    assert.ok(readiness.ownerActions.some(a => /host secret manager/i.test(a)));
  });

  it('reports free_tier readiness once opted in', () => {
    const readiness = chatDispatchReadiness(OPTED_IN);
    assert.equal(readiness.dispatchable, true);
    assert.equal(readiness.mode, 'free_tier');
    assert.deepEqual(readiness.blockers, []);
  });
});

describe('chat billing gate — the wrapper bypass is closed', () => {
  it('tags the real Google adapter as live', () => {
    assert.equal(isLiveChatAdapter(invokeGoogleChat), true);
  });

  it('keeps the live tag through the wrapping the production worker performs', () => {
    // This is the exact shape scripts/mission-chat-worker.ts uses. Under the old
    // `adapter === invokeGoogleChat` check this wrapper evaded the gate.
    const wrapped = markLiveChatAdapter((permit, signal, request) => invokeGoogleChat(permit, signal, request));
    assert.equal(isLiveChatAdapter(wrapped), true);
    assert.notEqual(wrapped, invokeGoogleChat, 'the wrapper is a distinct function, which is why identity checking failed');
  });

  it('treats an untagged test fixture as not live, so fixtures stay dispatchable', () => {
    const fixture = (async () => ({ outcome: 'succeeded', actualUsage: { requests: 1, tokens: 1 }, providerRef: 'x', evidence: 'fixture', value: 'hi' })) as never;
    assert.equal(isLiveChatAdapter(fixture), false);
  });

  it('cannot be untagged once marked', () => {
    const wrapped = markLiveChatAdapter((permit, signal, request) => invokeGoogleChat(permit, signal, request));
    assert.throws(() => {
      Object.defineProperty(wrapped, Symbol.for('za141251sa.live_chat_adapter'), { value: false });
    }, 'a safety marker must not be silently removable');
  });
});
