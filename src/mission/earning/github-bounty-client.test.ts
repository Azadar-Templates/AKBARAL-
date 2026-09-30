/** Isolated, hand-authored provider-shape fixtures. NO live GitHub API or money tests. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GithubBountyClient, GithubBountyError, classifyRepoPolicy, configuredGithubBountyClient } from './github-bounty-client';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fixture(responses: Array<Response | Error>, token: string | null = 'fixture-only-token') {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init: init! });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected request: fixture exhausted');
    return next;
  };
  return { client: new GithubBountyClient({ accessToken: token }, { fetch: transport }), calls };
}

it('is opt-in and works unauthenticated for discovery, never falls back to unrelated credentials', () => {
  assert.equal(configuredGithubBountyClient({}).authenticated, false);
  assert.equal(configuredGithubBountyClient({ GITHUB_TOKEN: 'unrelated' }).authenticated, false);
  assert.equal(configuredGithubBountyClient({ ZA141251SA_GITHUB_TOKEN: 'fixture-only' }).authenticated, true);
  assert.throws(() => new GithubBountyClient({ accessToken: 'bad token with spaces\r\n' }), /credentials_invalid/);
});

it('discovers open bounty-labeled issues only, excludes pull requests and closed issues, dedupes across queries', async () => {
  const issue = { number: 42, html_url: 'https://github.com/acme/widget/issues/42', title: 'Fix the widget bounty $250',
    state: 'open', labels: [{ name: 'bounty' }], repository_url: 'https://api.github.com/repos/acme/widget' };
  const pr = { number: 43, html_url: 'https://github.com/acme/widget/pull/43', title: 'A PR not an issue', state: 'open',
    labels: [{ name: 'bounty' }], pull_request: {}, repository_url: 'https://api.github.com/repos/acme/widget' };
  const closed = { number: 44, html_url: 'https://github.com/acme/widget/issues/44', title: 'Closed bounty', state: 'closed',
    labels: [{ name: 'bounty' }], repository_url: 'https://api.github.com/repos/acme/widget' };
  const { client, calls } = fixture([json({ items: [issue, pr, closed] }), json({ items: [issue] }), json({ items: [] })], null);
  const leads = await client.searchBountyIssues(10);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].repoFullName, 'acme/widget');
  assert.equal(leads[0].issueNumber, 42);
  assert.equal(leads[0].hintedAmountCents, 25000);
  assert.equal(leads[0].labels[0], 'bounty');
  assert.equal(calls[0].url.pathname, '/search/issues');
  assert.equal(new Headers(calls[0].init.headers).has('authorization'), false);
});

it('fetches repo policy files read-only, tolerates missing files, never writes', async () => {
  const contributing = { content: Buffer.from('Contributions welcome. AI-assisted PRs allowed with disclosure.').toString('base64'), encoding: 'base64' };
  const { client, calls } = fixture([json(contributing), json({}, 404), json({}, 404), json({}, 404), json({}, 404)]);
  const files = await client.fetchRepoPolicyFiles('acme/widget');
  assert.equal(files.length, 1);
  assert.match(files[0].content, /AI-assisted PRs allowed/);
  assert.ok(calls.every(c => c.init.method === undefined || c.init.method === 'GET'));
});

it('classifies explicit AI bans conservatively and defaults ambiguous/silent policy to disclosure-required, not unconditional permission', () => {
  const banned = classifyRepoPolicy('acme/widget', [{ path: 'CONTRIBUTING.md', content: 'We do not accept AI-generated pull requests. Humans only.' }], '2026-01-01T00:00:00.000Z');
  assert.equal(banned.aiContributionsAllowed, false);
  assert.equal(banned.disclosureRequired, true);

  const silent = classifyRepoPolicy('acme/widget', [], '2026-01-01T00:00:00.000Z');
  assert.equal(silent.aiContributionsAllowed, true);
  assert.equal(silent.disclosureRequired, true, 'silence must still require disclosure, never unconditional permission');
  assert.equal(silent.policySource, null);
});

it('creates a pull request only via the explicit authorize callback, and reports real merge state without inventing it', async () => {
  const { client, calls } = fixture([
    json({ number: 1, html_url: 'https://github.com/acme/widget/pull/1', head: { sha: 'a'.repeat(40) } }),
  ]);
  let authorized = false;
  const pr = await client.createPullRequest('acme/widget', 'bot-user', 'fix-branch', 'main', 'Fix bug', 'Body', () => { authorized = true; });
  assert.equal(authorized, true);
  assert.equal(pr.number, 1);
  assert.equal(calls[0].url.pathname, '/repos/acme/widget/pulls');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.head, 'bot-user:fix-branch');
  assert.equal(body.base, 'main');

  const { client: client2 } = fixture([json({ number: 1, html_url: 'https://x/1', merged: true, merged_at: '2026-01-01T00:00:00Z', state: 'closed', head: { sha: 'b'.repeat(40) } })]);
  const status = await client2.getPullRequest('acme/widget', 1);
  assert.equal(status.state, 'merged');
  assert.equal(status.mergedAt, '2026-01-01T00:00:00Z');
});

it('never leaks the token into thrown errors or serialized state, and surfaces rate limiting distinctly', async () => {
  const rateLimited = new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) } });
  const { client } = fixture([rateLimited]);
  await assert.rejects(client.searchBountyIssues(5), (error: unknown) => {
    assert.ok(error instanceof GithubBountyError);
    assert.equal(error.code, 'github_rate_limited');
    assert.equal(JSON.stringify(error).includes('fixture-only-token'), false);
    return true;
  });
});
