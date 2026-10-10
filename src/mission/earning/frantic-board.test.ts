import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  createFranticBoardClient,
  parseBoard,
  parsePolicy,
  screenFranticBounty,
} = require('./frantic-board') as typeof import('./frantic-board');
type FranticBoardBounty = import('./frantic-board').FranticBoardBounty;

/** Shape copied from a live `GET /v1/board` read, with the venue's own claim gates. */
function boardPayload(rows: unknown[]) {
  return {
    ok: true,
    board: {
      founded: '2026-07-09',
      day: 94,
      live: true,
      bounties_open: rows.length,
      funded_usd: 802,
      moved_usd: 1302.85,
      operators_enlisted: 1344,
      sworn_count: 504,
      open_bounties: rows,
    },
  };
}

function bountyRow(overrides: Record<string, unknown> = {}) {
  return {
    number: 128,
    title: 'Earn a citation for an open data registry on a real external site',
    visibility: 'private',
    price_usd: 8,
    funded: true,
    work_status: 'open',
    note: 'Deliver a citation on a real external site. Acceptance: the page must be live.',
    claim_slots: { capacity: 15, occupied: 4, available: 11 },
    url: '/bounties/128',
    api_url: '/v1/bounties/128',
    actions: {
      claim: {
        available: true,
        state: 'requires_identity',
        method: 'POST',
        endpoint: '/v1/claims',
        requires: ['agent_kid', 'agent_token', 'verified_email_or_runx_github_identity'],
        reason: 'This paid bounty is $10 or less. It can be claimed after contact identity is verified.',
      },
    },
    ...overrides,
  };
}

function row(input: Record<string, unknown>): FranticBoardBounty {
  const parsed = parseBoard({ ok: true, board: { open_bounties: [input] } }).bounties[0];
  assert.ok(parsed, 'fixture row must parse');
  return parsed;
}

test('the board reader parses live rows and drops anything that is not a bounty', () => {
  const parsed = parseBoard(boardPayload([
    bountyRow(),
    bountyRow({ number: 33, title: 'Publish Sourcey docs for a maintained OSS library', price_usd: 20 }),
    { title: 'no number at all' },
    { number: 5 },
    'not an object',
    null,
  ]));
  assert.equal(parsed.bounties.length, 2);
  assert.equal(parsed.bounties[0].priceUsdCents, 800);
  assert.equal(parsed.bounties[1].priceUsdCents, 2000);
  assert.equal(parsed.bounties[0].slotsAvailable, 11);
  assert.equal(parsed.bounties[0].claim?.state, 'requires_identity');
  assert.deepEqual(parsed.bounties[0].claim?.requires, ['agent_kid', 'agent_token', 'verified_email_or_runx_github_identity']);
  assert.equal(parsed.stats.moved_usd, 1302.85);
  assert.equal(parsed.stats.operators_enlisted, 1344);
  assert.throws(() => parseBoard({ ok: false }), /frantic_invalid_response/);
  assert.throws(() => parseBoard({ ok: true, board: {} }), /frantic_invalid_response/);
});

test('work that needs another platform, owner money, or identity screening is refused as policy, not scheduled', () => {
  const citation = screenFranticBounty(row(bountyRow()));
  assert.equal(citation.screen, 'refused_policy');
  assert.ok(citation.reasons.includes('deliverable_is_a_post_on_another_platform'));
  assert.ok(citation.ownerActions.some(action => /owner decides/.test(action)));

  const rebate = screenFranticBounty(row(bountyRow({
    number: 97,
    title: 'Your first bounty is on the house ($10 back when it clears, first five)',
    note: 'Bring real work through the door, fund it ($10 or more), and claim your $10 back.',
  })));
  assert.equal(rebate.screen, 'refused_policy');
  assert.ok(rebate.reasons.includes('requires_owner_funding_or_rebate'));

  const kyc = screenFranticBounty(row(bountyRow({ note: 'Complete identity verification (KYC) before delivery.' })));
  assert.ok(kyc.reasons.includes('terms_mention_identity_or_kyc'));
});

test('a plain deliverable is blocked only by the owner-side identity step, and names that step', () => {
  const result = screenFranticBounty(row(bountyRow({
    title: 'Generate API reference docs for a pinned release',
    note: 'Acceptance: public_url loads with a navigable docs site and evidence.json lists the pages.',
  })));
  assert.equal(result.screen, 'blocked_by_owner_action');
  assert.ok(result.reasons.includes('claim_gate_requires_identity'));
  assert.ok(result.ownerActions.some(action => /owner email and GitHub handle/.test(action)));
  assert.ok(result.evidence.some(line => line.startsWith('claim_gate:')));
});

test('the larger paid tier stays blocked until the venue has a reason to unlock it', () => {
  const overTen = row(bountyRow({
    number: 33,
    price_usd: 20,
    title: 'Publish docs for a maintained OSS library',
    note: 'Acceptance: public_url loads and evidence.json covers 20 APIs.',
    actions: {
      claim: {
        available: true,
        state: 'requires_identity',
        requires: ['agent_kid', 'agent_token', 'verified_email_or_runx_github_identity', 'eligible_operator_or_successful_paid_bounty'],
        reason: 'This paid bounty is over $10. It requires normal paid eligibility or one successful paid bounty.',
      },
    },
  }));
  const blocked = screenFranticBounty(overTen);
  assert.ok(blocked.reasons.includes('paid_tier_requires_prior_settled_bounty'));
  const unlocked = screenFranticBounty(overTen, { paidTierUnlocked: true });
  assert.ok(!unlocked.reasons.includes('paid_tier_requires_prior_settled_bounty'));
});

test('missing acceptance text, closed slots or an unfunded row never read as eligible work', () => {
  const bare = screenFranticBounty(row(bountyRow({
    title: 'Document the public CLI surface for the pinned release',
    note: '',
    actions: undefined,
  })));
  assert.equal(bare.screen, 'unverifiable');
  assert.ok(bare.reasons.includes('acceptance_text_absent'));
  assert.ok(bare.reasons.includes('claim_gate_unreadable'));

  const drained = screenFranticBounty(row(bountyRow({ claim_slots: { capacity: 10, occupied: 10, available: 0 } })));
  assert.ok(drained.reasons.includes('no_open_slots'));

  const unfunded = screenFranticBounty(row(bountyRow({ funded: false, price_usd: undefined })));
  assert.ok(unfunded.reasons.includes('not_funded'));
  assert.ok(unfunded.reasons.includes('price_unreadable'));
});

test('the policy read keeps the economy numbers that bound the clock, without inventing charges', () => {
  const policy = parsePolicy({ ok: true, policy: { rent_cents_per_day: 1000, welcome_runway_days: 5, max_runway_days: 30, live_cap_cents: 30000 } });
  assert.deepEqual(policy, { rentCentsPerDay: 1000, welcomeRunwayDays: 5, maxRunwayDays: 30, liveCapCents: 30000 });
  assert.deepEqual(parsePolicy(undefined), { rentCentsPerDay: null, welcomeRunwayDays: null, maxRunwayDays: null, liveCapCents: null });
});

test('the client only ever issues reads, and a transport or payload failure is an error, not an empty board', async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const client = createFranticBoardClient({
    now: () => Date.parse('2026-10-10T01:00:00.000Z'),
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method });
      return new Response(JSON.stringify(url.endsWith('/v1/policy')
        ? { ok: true, policy: { rent_cents_per_day: 1000 } }
        : boardPayload([bountyRow()])), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const read = await client.read();
  assert.equal(read.asOf, '2026-10-10T01:00:00.000Z');
  assert.equal(read.board.bounties.length, 1);
  assert.equal(read.policy.rentCentsPerDay, 1000);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);
  assert.ok(calls.every(call => call.url.startsWith('https://gofrantic.com/v1/')));

  // A traversal-shaped reference stays inside the allowlisted read path; nothing else is fetched.
  await client.readBounty('../../etc/passwd');
  const sanitized = calls[calls.length - 1].url;
  assert.ok(sanitized.startsWith('https://gofrantic.com/v1/bounties/'), sanitized);
  assert.ok(!sanitized.includes('/etc/passwd'), sanitized);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  assert.equal(await client.readBounty(''), null);

  const failing = createFranticBoardClient({
    fetch: async () => new Response('boom', { status: 503 }),
  });
  await assert.rejects(failing.read(), /frantic_transport_failure/);

  const html = createFranticBoardClient({ fetch: async () => new Response('<html>', { status: 200 }) });
  await assert.rejects(html.read(), /frantic_invalid_response/);

  const oversized = createFranticBoardClient({
    fetch: async () => new Response('x'.repeat(2048), { status: 200, headers: { 'content-length': '99999999' } }),
  });
  await assert.rejects(oversized.read(), /frantic_response_too_large/);
});
