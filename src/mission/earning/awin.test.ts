/** Isolated, hand-authored provider-shape fixtures. NO live API or money tests. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { AwinPublisherClient, AwinError, configuredAwinClient } from './awin';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const lead = { id: 2, name: 'Fixture advertiser, not a real opportunity', status: 'active' };
const details = () => ({ programmeInfo: { id: 2, membershipStatus: 'Joined', deeplinkEnabled: true,
  validDomains: [{ domain: 'fixture-shop.example' }], linkStatus: 'online' } });
const input = () => ({ advertiserId: '2', destinationUrl: 'https://fixture-shop.example/item', clickRef: 'fixture-job-only' });
const link = { url: 'https://www.awin1.com/cread.php?awinaffid=1&awinmid=2&clickref=fixture-job-only' };
const lookup = { ids: ['3'], advertiserId: '2', clickRef: 'fixture-job-only' };
const transaction = () => ({ id: 3, publisherId: 1, advertiserId: 2, commissionStatus: 'approved',
  commissionAmount: { amount: 5.59, currency: 'GBP' }, clickRefs: { clickRef: 'fixture-job-only' },
  paidToPublisher: false, paymentId: 0 });
let sequence = 0;
function fixture(responses: Array<Response | Error>, token = `fixture-only-${++sequence}`) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  let time = 100000;
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init: init! });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected request: fixture exhausted');
    return next;
  };
  return { client: new AwinPublisherClient({ publisherId: '1', accessToken: token }, { fetch: transport, now: () => time }),
    calls, advance: (ms: number) => { time += ms; } };
}

it('is opt-in and does not fall back to platform/customer credentials', () => {
  assert.equal(configuredAwinClient({ AWIN_ACCESS_TOKEN: 'fixture-only' }), null);
  assert.throws(() => configuredAwinClient({ ZA141251SA_AWIN_ENABLED: 'true', AWIN_ACCESS_TOKEN: 'fixture-only' }), /credentials_required/);
  assert.throws(() => new AwinPublisherClient({ publisherId: '../accounts', accessToken: 'fixture-only' }), /invalid_id/);
  assert.throws(() => new AwinPublisherClient({ publisherId: '01', accessToken: 'fixture-only' }), /invalid_id/);
  assert.throws(() => new AwinPublisherClient({ publisherId: '1', accessToken: 'fixture\r\nheader' }), /credentials_required/);
});
it('discovers authenticated joined programme leads, never executable jobs or invented revenue', async () => {
  const { client, calls } = fixture([json([lead])]);
  const result = await client.discoverJoinedPrograms();
  assert.equal(result[0].kind, 'affiliate_program_lead'); assert.equal(result[0].executable, false);
  assert.equal('revenue' in result[0], false);
  assert.equal(calls[0].url.origin, 'https://api.awin.com');
  assert.equal(calls[0].url.pathname, '/publishers/1/programmes');
  assert.equal(calls[0].url.searchParams.get('relationship'), 'joined');
  assert.equal(calls[0].url.searchParams.has('accessToken'), false);
  assert.match(new Headers(calls[0].init.headers).get('authorization')!, /^Bearer fixture-only-/);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal);
  assert.equal(JSON.stringify(client).includes('fixture-only'), false);
});
it('no matching programmes means no manufactured opportunities', async () => {
  assert.deepEqual(await fixture([json([])]).client.discoverJoinedPrograms(), []);
});
it('rejects duplicate or malformed programme evidence rather than substituting defaults', async () => {
  for (const body of [[lead, lead], [{ ...lead, id: '01' }], [{ ...lead, status: 'invented' }], {}, [{ ...lead, name: '' }]]) {
    await assert.rejects(fixture([json(body)]).client.discoverJoinedPrograms(), AwinError);
  }
});
it('checks current membership and exact destination domain, then authorizes immediately before POST', async () => {
  const { client, calls } = fixture([json(details()), json(link)]);
  let checked = false;
  const result = await client.createTrackingLink(input(), () => { assert.equal(calls.length, 1); checked = true; });
  assert.equal(checked, true); assert.equal(result.state, 'link_created_not_published');
  assert.equal('paymentReference' in result, false);
  assert.equal(calls[0].url.pathname, '/publishers/1/programmedetails');
  assert.equal(calls[0].url.searchParams.get('advertiserId'), '2');
  assert.equal(calls[1].url.pathname, '/publishers/1/linkbuilder/generate');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { advertiserId: 2, destinationUrl: input().destinationUrl,
    parameters: { clickref: input().clickRef }, shorten: false });
});
it('blocks suspended/rejected/pending membership, disabled deeplinks and offline links', async () => {
  for (const patch of [{ membershipStatus: 'Suspended' }, { membershipStatus: 'Pending' }, { membershipStatus: 'Rejected' },
    { deeplinkEnabled: false }, { linkStatus: 'offline' }, { id: 9 }]) {
    const body = details(); Object.assign(body.programmeInfo, patch);
    const { client, calls } = fixture([json(body)]);
    await assert.rejects(client.createTrackingLink(input(), () => assert.fail('must not authorize')), /not_eligible/);
    assert.equal(calls.length, 1);
  }
});
it('does not accept lookalike/subdomain destinations or embedded credentials', async () => {
  for (const destinationUrl of ['https://fixture-shop.example.evil.example/item', 'https://child.fixture-shop.example/item']) {
    const { client, calls } = fixture([json(details())]);
    await assert.rejects(client.createTrackingLink({ ...input(), destinationUrl }, () => {}), /destination_not_allowed/);
    assert.equal(calls.length, 1);
  }
  for (const destinationUrl of ['http://fixture-shop.example', 'https://secret@fixture-shop.example', 'file:///etc/passwd']) {
    const { client, calls } = fixture([]);
    await assert.rejects(client.createTrackingLink({ ...input(), destinationUrl }, () => {}), /invalid_url/);
    assert.equal(calls.length, 0);
  }
});
it('final authorization failure prevents POST, without claiming a remote effect', async () => {
  const { client, calls } = fixture([json(details())]);
  await assert.rejects(client.createTrackingLink(input(), () => { throw Error('owner_frozen'); }), /owner_frozen/);
  assert.equal(calls.length, 1);
});
it('cancellation before dispatch and cancellation inside authorization prevent remote effects', async () => {
  const before = new AbortController(); before.abort();
  const f = fixture([]);
  await assert.rejects(f.client.discoverJoinedPrograms(before.signal), /cancelled/);
  assert.equal(f.calls.length, 0);
  const after = new AbortController(), g = fixture([json(details())]);
  await assert.rejects(g.client.createTrackingLink(input(), () => after.abort(), after.signal), /cancelled/);
  assert.equal(g.calls.length, 1);
});
it('freezes submitted attribution input across eligibility awaits', async () => {
  const f = fixture([json(details()), json(link)]), request = input();
  const result = f.client.createTrackingLink(request, () => { request.clickRef = 'changed'; });
  assert.equal((await result).state, 'link_created_not_published');
  assert.equal(JSON.parse(String(f.calls[1].init.body)).parameters.clickref, 'fixture-job-only');
});
it('rejects malformed or wrong-account returned links as an uncertain effect; never retries POST', async () => {
  for (const body of [{ description: 'Unknown error! Please try again later!' },
    { url: link.url.replace('awinaffid=1', 'awinaffid=9') }, { url: link.url.replace('awinmid=2', 'awinmid=9') },
    { url: link.url.replace('fixture-job-only', 'other-job') }, { url: link.url.replace('www.awin1.com', 'evil.example') },
    { url: `${link.url}&awinaffid=9` }]) {
    const { client, calls } = fixture([json(details()), json(body)]);
    await assert.rejects(client.createTrackingLink(input(), () => {}), (error: unknown) => error instanceof AwinError && error.effectMayHaveOccurred);
    assert.equal(calls.length, 2);
  }
});
it('a transport failure after POST is uncertain and contains no provider error/token text', async () => {
  const { client, calls } = fixture([json(details()), new Error('secret raw provider body or token')]);
  await assert.rejects(client.createTrackingLink(input(), () => {}), (error: unknown) =>
    error instanceof AwinError && error.effectMayHaveOccurred && !JSON.stringify(error).includes('secret raw') && !error.message.includes('secret raw'));
  assert.equal(calls.length, 2);
});
it('401/403 block access without retries or response-body disclosure', async () => {
  for (const status of [401, 403]) {
    const { client, calls } = fixture([json({ secret: 'never expose' }, status)]);
    await assert.rejects(client.discoverJoinedPrograms(), { message: 'awin_access_denied' });
    assert.equal(calls.length, 1);
  }
});
it('429 honors retry-after across same-token clients, even across publisher IDs', async () => {
  const token = `fixture-only-${++sequence}`, f = fixture([json({}, 429, { 'retry-after': '120' }), json([])], token);
  await assert.rejects(f.client.discoverJoinedPrograms(), (error: unknown) => error instanceof AwinError && error.retryAfterMs === 120000);
  const second = new AwinPublisherClient({ publisherId: '2', accessToken: token }, { fetch: async () => assert.fail('must stay blocked'), now: () => 100000 });
  await assert.rejects(second.discoverJoinedPrograms(), /rate_limited/);
  f.advance(120001); assert.deepEqual(await f.client.discoverJoinedPrograms(), []);
});
it('enforces a rolling twenty-request limit and allows safe later reads', async () => {
  const f = fixture(Array.from({ length: 21 }, () => json([])));
  for (let i = 0; i < 20; i++) await f.client.discoverJoinedPrograms();
  await assert.rejects(f.client.discoverJoinedPrograms(), /rate_limited/); assert.equal(f.calls.length, 20);
  f.advance(60001); await f.client.discoverJoinedPrograms(); assert.equal(f.calls.length, 21);
});
it('bounds response bytes and rejects malformed JSON, HTML, redirect and server failure', async () => {
  const responses = [new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }), new Response('<html>login</html>'),
    json({}, 302), json({}, 503)];
  for (const response of responses) {
    const { client, calls } = fixture([response]);
    await assert.rejects(client.discoverJoinedPrograms(), AwinError); assert.equal(calls.length, 1);
  }
});
it('reads provider transaction IDs bound to publisher, advertiser and job attribution, without converting to cash', async () => {
  const { client, calls } = fixture([json([transaction()])]);
  const { transactions, unreturnedIds } = await client.transactionsByIds({ ...lookup, ids: ['3', '4'] });
  assert.deepEqual(unreturnedIds, ['4']); assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0].commissionAmount, { decimal: '5.59', currency: 'GBP' });
  assert.equal(transactions[0].cashCreditEligible, false); assert.equal(transactions[0].treasurySettlement, 'unverified');
  assert.equal(transactions[0].paymentId, null);
  assert.equal(calls[0].url.pathname, '/publishers/1/transactions');
  assert.equal(calls[0].url.searchParams.get('ids'), '3,4'); assert.equal(calls[0].url.searchParams.get('timezone'), 'UTC');
});
it('even paidToPublisher with a payment ID does not certify available mission funds', async () => {
  const row = { ...transaction(), paidToPublisher: true, paymentId: 77 };
  const result = await fixture([json([row])]).client.transactionsByIds(lookup);
  assert.equal(result.transactions[0].paymentId, '77'); assert.equal(result.transactions[0].cashCreditEligible, false);
  assert.equal(result.transactions[0].treasurySettlement, 'unverified');
});
it('missing transactions remain unresolved, not synthetic payments or inferred reversals', async () => {
  assert.deepEqual(await fixture([json([])]).client.transactionsByIds(lookup), { transactions: [], unreturnedIds: ['3'] });
});
it('rejects mismatched, duplicate, unsafe or malformed transaction evidence', async () => {
  for (const patch of [{ publisherId: 9 }, { advertiserId: 9 }, { id: 9 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { clickRefs: { clickRef: 'different-job' } }, { commissionStatus: 'paid' }, { paidToPublisher: 'true' },
    { paidToPublisher: true, paymentId: 0 }, { commissionAmount: { amount: '5.5999999', currency: 'GBP' } },
    { commissionAmount: { amount: Number.MAX_SAFE_INTEGER + 1, currency: 'GBP' } },
    { commissionAmount: { amount: 10, currency: 'gbp' } }]) {
    await assert.rejects(fixture([json([{ ...transaction(), ...patch }])]).client.transactionsByIds(lookup), AwinError);
  }
  await assert.rejects(fixture([json([transaction(), transaction()])]).client.transactionsByIds(lookup), /duplicate_evidence/);
});
it('preserves declined/deleted and negative reported commissions as evidence, not new cash', async () => {
  for (const commissionStatus of ['declined', 'deleted', 'pending']) {
    const row = { ...transaction(), commissionStatus, commissionAmount: { amount: '-5.59', currency: 'GBP' } };
    const result = await fixture([json([row])]).client.transactionsByIds(lookup);
    assert.equal(result.transactions[0].commissionStatus, commissionStatus);
    assert.equal(result.transactions[0].commissionAmount.decimal, '-5.59'); assert.equal(result.transactions[0].cashCreditEligible, false);
  }
});
it('validates batches before sending any request', async () => {
  for (const ids of [[], ['3', '3'], ['../'], Array.from({ length: 101 }, (_, i) => String(i + 1))]) {
    const { client, calls } = fixture([]);
    await assert.rejects(client.transactionsByIds({ ...lookup, ids }), AwinError); assert.equal(calls.length, 0);
  }
});

it('does not expose credentials even if a provider returns them inside a valid tracking URL', async () => {
  const token = `fixture-sensitive-${++sequence}`;
  const f = fixture([json(details()), json({ url: `${link.url}&unexpected=${token}` })], token);
  await assert.rejects(f.client.createTrackingLink(input(), () => {}), (error: unknown) =>
    error instanceof AwinError && error.effectMayHaveOccurred && !JSON.stringify(error).includes(token));
});
it('server errors or throttling after POST are uncertain and never trigger automatic resubmission', async () => {
  for (const status of [429, 500, 503]) {
    const f = fixture([json(details()), json({}, status)]);
    await assert.rejects(f.client.createTrackingLink(input(), () => {}), (error: unknown) =>
      error instanceof AwinError && error.effectMayHaveOccurred);
    assert.equal(f.calls.length, 2);
  }
});
