/**
 * GitHub REST API primitives for bounty-labeled issue discovery, repository
 * contribution-policy checks, and pull-request submission/tracking.
 *
 * Every call here uses GitHub's own public, documented REST API exactly the
 * way any legitimate integration (Dependabot, Renovate, a CI bot) does —
 * automated search, automated PR creation, and automated status polling are
 * all explicitly permitted by GitHub's own terms (docs.github.com/en/site-
 * policy). This file never touches a third-party bounty marketplace's own
 * website/UI; if a marketplace's own terms restrict automated access to ITS
 * service (e.g. Algora's terms prohibit bot access to algora.io itself), this
 * client does not call that marketplace at all — only github.com/api.github.com.
 *
 * No registration/import-time network calls. See docs/REAL_EARNING_WORKFORCE.md.
 */
import { createHash } from 'node:crypto';

export class GithubBountyError extends Error {
  constructor(public readonly code: string, public readonly effectMayHaveOccurred = false,
    public readonly retryAfterMs: number | null = null) { super(code); this.name = 'GithubBountyError'; }
}
function fail(code = 'github_invalid_response'): never { throw new GithubBountyError(code); }
function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return fail();
  return value;
}
function nonEmpty(value: unknown, max = 240): string {
  const s = text(value, max);
  if (!s.trim()) return fail();
  return s;
}
function repoFullName(value: unknown): string {
  const s = text(value, 200);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(s)) return fail('github_invalid_repo');
  return s;
}
function branchName(value: unknown): string {
  const s = text(value, 200);
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(s) || s.includes('..') || s.startsWith('-')) return fail('github_invalid_branch');
  return s;
}
function issueNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return fail('github_invalid_issue_number');
  return value;
}

// Conservative single-process rolling limit shared by clients using the same token.
const limits = new Map<string, { starts: number[]; blockedUntil: number }>();
const WINDOW_MS = 60000;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * A small process-wide token bucket. The rolling ceiling below is still the
 * final safety check, while this gate spaces bursts from parallel agents and
 * shares an explicit cooldown after GitHub returns 403/429. Waiting is
 * deliberate: callers do not spin or create retry storms.
 */
export class GithubBountyRateGate {
  #tokens: number;
  #lastRefill: number;
  #blockedUntil = 0;
  #waiters = 0;
  readonly #capacity: number;
  readonly #refillPerMs: number;
  constructor(capacity: number, now: () => number = Date.now) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('invalid_rate_gate_capacity');
    this.#capacity = capacity;
    this.#tokens = capacity;
    this.#lastRefill = now();
    this.#refillPerMs = capacity / WINDOW_MS;
    this.#now = now;
  }
  readonly #now: () => number;
  cooldown(delayMs: number): void {
    if (Number.isFinite(delayMs) && delayMs > 0) this.#blockedUntil = Math.max(this.#blockedUntil, this.#now() + delayMs);
  }
  async acquire(): Promise<void> {
    this.#waiters += 1;
    try {
      for (;;) {
        const now = this.#now();
        const elapsed = Math.max(0, now - this.#lastRefill);
        this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerMs);
        this.#lastRefill = now;
        const blockedFor = this.#blockedUntil - now;
        if (blockedFor <= 0 && this.#tokens >= 1) { this.#tokens -= 1; return; }
        const refillFor = this.#tokens >= 1 ? 0 : Math.ceil((1 - this.#tokens) / this.#refillPerMs);
        await new Promise(resolve => setTimeout(resolve, Math.max(10, blockedFor, refillFor)));
      }
    } finally { this.#waiters -= 1; }
  }
  snapshot(): { capacity: number; tokens: number; blockedUntil: number; waiters: number } {
    return { capacity: this.#capacity, tokens: this.#tokens, blockedUntil: this.#blockedUntil, waiters: this.#waiters };
  }
}

const rateGates = new Map<string, GithubBountyRateGate>();
function gateFor(key: string, authenticated: boolean, now: () => number): GithubBountyRateGate {
  let gate = rateGates.get(key);
  if (!gate) { gate = new GithubBountyRateGate(authenticated ? 30 : 10, now); rateGates.set(key, gate); }
  return gate;
}

export interface GithubClientDependencies { fetch?: typeof fetch; now?: () => number; beforeRequest?: () => void; onRateLimit?: (delayMs: number) => void; rateGate?: GithubBountyRateGate }

/** Bounty-label search terms. Kept narrow and explicit — never a generic crawl. */
const BOUNTY_SEARCH_QUERIES = [
  'label:bounty state:open',
  'label:"help wanted" label:bounty state:open',
  'label:paid-issue state:open',
];

export class GithubBountyClient {
  #token: string | null;
  #key: string;
  #fetch: typeof fetch;
  #now: () => number;
  #beforeRequest?: () => void;
  #onRateLimit?: (delayMs: number) => void;
  #rateGate: GithubBountyRateGate;
  constructor(config: { accessToken: string | null }, dependencies: GithubClientDependencies = {}) {
    if (config.accessToken !== null) {
      if (typeof config.accessToken !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(config.accessToken) || config.accessToken.length > 8192) fail('github_credentials_invalid');
    }
    this.#token = config.accessToken;
    this.#key = createHash('sha256').update(this.#token ?? 'anonymous').digest('hex');
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#now = dependencies.now ?? Date.now;
    this.#beforeRequest = dependencies.beforeRequest;
    this.#onRateLimit = dependencies.onRateLimit;
    this.#rateGate = dependencies.rateGate ?? gateFor(this.#key, this.#token !== null, this.#now);
  }
  get authenticated(): boolean { return this.#token !== null; }

  #reserveRequest(): void {
    const now = this.#now();
    const state = limits.get(this.#key) ?? { starts: [], blockedUntil: 0 };
    state.starts = state.starts.filter(t => now - t < WINDOW_MS);
    limits.set(this.#key, state);
    if (now < state.blockedUntil) throw new GithubBountyError('github_rate_limited', false, state.blockedUntil - now);
    // Conservative: well under GitHub's 5000/hr authenticated, 60/hr unauthenticated ceilings.
    const ceiling = this.#token ? 30 : 10;
    if (state.starts.length >= ceiling) throw new GithubBountyError('github_rate_limited', false, Math.max(1, WINDOW_MS - (now - state.starts[0])));
    state.starts.push(now);
  }

  async #request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, query: Record<string, string> | undefined,
    parse: (value: unknown, status: number) => T, body?: unknown, mutation?: { authorize: () => void }): Promise<T> {
    const signal = AbortSignal.timeout(20000);
    await this.#rateGate.acquire();
    this.#reserveRequest();
    this.#beforeRequest?.();
    mutation?.authorize();
    const url = new URL(path, 'https://api.github.com');
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    let response: Response | undefined;
    try {
      response = await this.#fetch(url, {
        method, redirect: 'error', signal,
        headers: {
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'akbaral-mission-bounty-workflow',
          ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        const delay = remaining === '0' && reset && /^\d+$/.test(reset) ? Math.max(WINDOW_MS, Number(reset) * 1000 - this.#now()) : WINDOW_MS;
        this.#rateGate.cooldown(delay);
        this.#onRateLimit?.(delay);
        throw new GithubBountyError('github_rate_limited', !!mutation, delay);
      }
      if (response.status === 401) throw new GithubBountyError('github_access_denied');
      if (response.status === 404) throw new GithubBountyError('github_not_found');
      if (response.status === 422) throw new GithubBountyError('github_validation_failed', !!mutation);
      if (response.status >= 500) throw new GithubBountyError('github_upstream_failure', !!mutation);
      const size = Number(response.headers.get('content-length') ?? '0');
      if (size > MAX_BYTES) fail('github_response_too_large');
      const raw = await response.text();
      if (raw.length > MAX_BYTES) fail('github_response_too_large');
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (response.status >= 200 && response.status < 300) return parse(parsed, response.status);
      throw new GithubBountyError('github_http_failure', !!mutation);
    } catch (error) {
      if (error instanceof GithubBountyError) throw error;
      throw new GithubBountyError('github_transport_or_parse_failure', !!mutation);
    }
  }

  /** Public, unauthenticated-capable search across explicit bounty-style labels only. */
  async searchBountyIssues(limit = 30, signal?: AbortSignal): Promise<BountyLeadRaw[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 50) fail('github_invalid_limit');
    void signal;
    const seen = new Map<string, BountyLeadRaw>();
    for (const q of BOUNTY_SEARCH_QUERIES) {
      const page = await this.#request('GET', '/search/issues', { q, per_page: String(Math.min(limit, 30)), sort: 'created', order: 'desc' },
        value => value as { items?: unknown[] });
      for (const raw of page.items ?? []) {
        const item = raw as Record<string, unknown>;
        if (typeof item.pull_request === 'object' && item.pull_request !== null) continue; // exclude PRs, issues only
        if (item.state !== 'open') continue;
        const repoUrl = typeof item.repository_url === 'string' ? item.repository_url : '';
        const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)$/.exec(repoUrl);
        if (!match) continue;
        const repo = repoFullName(match[1]);
        const number = issueNumber(item.number);
        const key = `${repo}#${number}`;
        if (seen.has(key)) continue;
        const labels = Array.isArray(item.labels) ? item.labels.map(l => typeof l === 'object' && l ? String((l as Record<string, unknown>).name ?? '') : String(l)).filter(Boolean) : [];
        const title = nonEmpty(item.title, 400);
        // Search results include the issue body. A title or label hint is not
        // evidence of a bounty, so discard leads without an explicit currency
        // declaration in this real GitHub response.
        const issueBody = typeof item.body === 'string' && item.body.length <= 30000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.body) ? item.body : '';
        const declaredAmountCents = extractDeclaredAmountCents(issueBody);
        if (declaredAmountCents === null) continue;
        seen.set(key, { repoFullName: repo, issueNumber: number, issueUrl: nonEmpty(item.html_url, 400), title, labels, issueBody, hintedAmountCents: declaredAmountCents });
      }
      if (seen.size >= limit) break;
    }
    return [...seen.values()].slice(0, limit);
  }

  /** Read-only repo policy files. Never writes, never authenticates as the repo's own bot. */
  async fetchRepoPolicyFiles(repo: string, signal?: AbortSignal): Promise<{ path: string; content: string }[]> {
    const name = repoFullName(repo);
    const candidates = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'AI.md', '.github/AI.md', 'README.md'];
    const found: { path: string; content: string }[] = [];
    for (const path of candidates) {
      try {
        const result = await this.#request('GET', `/repos/${name}/contents/${path}`, undefined, value => value as Record<string, unknown>);
        if (typeof result.content === 'string' && result.encoding === 'base64') {
          found.push({ path, content: Buffer.from(result.content.replace(/\n/g, ''), 'base64').toString('utf8').slice(0, 20000) });
        }
      } catch (error) {
        if (error instanceof GithubBountyError && error.code === 'github_not_found') continue;
        throw error;
      }
    }
    void signal;
    return found;
  }

  async currentUserLogin(): Promise<string> {
    const me = await this.#request('GET', '/user', undefined, value => value as Record<string, unknown>);
    return nonEmpty(me.login, 80);
  }

  /** Read-only public repo metadata (stars/age/open issues) used only for fraud/bait-repo
   * risk scoring before any work is prepared — never for gating on the repo owner's identity. */
  async fetchRepoMetadata(repo: string): Promise<RepoMetadataRaw> {
    const name = repoFullName(repo);
    const result = await this.#request('GET', `/repos/${name}`, undefined, value => value as Record<string, unknown>);
    const created = typeof result.created_at === 'string' ? result.created_at : null;
    const defaultBranch = typeof result.default_branch === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(result.default_branch) ? result.default_branch : null;
    return {
      repoFullName: name,
      stargazersCount: Number.isSafeInteger(result.stargazers_count) ? Number(result.stargazers_count) : 0,
      forksCount: Number.isSafeInteger(result.forks_count) ? Number(result.forks_count) : 0,
      openIssuesCount: Number.isSafeInteger(result.open_issues_count) ? Number(result.open_issues_count) : 0,
      createdAt: created,
      archived: result.archived === true,
      fork: result.fork === true,
      defaultBranch,
    };
  }

  /** Read-only issue detail. Its body is untrusted data; callers must not
   * execute, follow instructions from, or interpolate it as a system prompt. */
  async fetchIssueDetail(repo: string, number: number): Promise<BountyIssueDetailRaw> {
    const name = repoFullName(repo), n = issueNumber(number);
    const result = await this.#request('GET', `/repos/${name}/issues/${n}`, undefined, value => value as Record<string, unknown>);
    if (result.state !== 'open' || (result.pull_request && typeof result.pull_request === 'object')) fail('github_issue_not_open');
    const title = nonEmpty(result.title, 400);
    const body = typeof result.body === 'string' ? result.body : '';
    if (body.length > 30000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)) fail('github_invalid_issue_body');

    const url = nonEmpty(result.html_url, 400);
    const labels = Array.isArray(result.labels) ? result.labels.map(label => typeof label === 'object' && label ? String((label as Record<string, unknown>).name ?? '') : String(label)).filter(value => value.length > 0 && value.length <= 160) : [];
    return { repoFullName: name, issueNumber: n, issueUrl: url, title, body, labels };
  }

  /** Bounded, read-only source archive download. The archive is intentionally
   * opaque to the mission process and is unpacked only by the isolated runner. */
  async downloadRepositoryArchive(repo: string, ref: string): Promise<Uint8Array> {
    const name = repoFullName(repo), branch = branchName(ref);
    const signal = AbortSignal.timeout(30000);
    await this.#rateGate.acquire();
    this.#reserveRequest();
    this.#beforeRequest?.();
    let response: Response | undefined;
    try {
      response = await this.#fetch(new URL(`/repos/${name}/tarball/${branch}`, 'https://api.github.com'), {
        method: 'GET', redirect: 'error', signal,
        headers: {
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'akbaral-mission-bounty-workflow',
          ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
      });
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        const delay = remaining === '0' && reset && /^\d+$/.test(reset) ? Math.max(WINDOW_MS, Number(reset) * 1000 - this.#now()) : WINDOW_MS;
        this.#rateGate.cooldown(delay);
        this.#onRateLimit?.(delay);
        throw new GithubBountyError('github_rate_limited', false, delay);
      }
      if (response.status === 401) throw new GithubBountyError('github_access_denied');
      if (response.status === 404) throw new GithubBountyError('github_not_found');
      if (response.status < 200 || response.status >= 300) throw new GithubBountyError('github_http_failure');
      const size = Number(response.headers.get('content-length') ?? '0');
      const maximum = 64 * 1024 * 1024;
      if (!Number.isFinite(size) || size < 0 || size > maximum || !response.body) fail('github_response_too_large');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let received = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (received > maximum) { await reader.cancel(); fail('github_response_too_large'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      if (!received) fail('github_response_too_large');
      const bytes = new Uint8Array(received); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    } catch (error) {
      if (error instanceof GithubBountyError) throw error;
      throw new GithubBountyError('github_transport_or_parse_failure');
    }
  }

  /** Idempotent: GitHub returns 202/200 for an already-existing fork. */
  async ensureFork(repo: string, authorizeMutation: () => void): Promise<void> {
    const name = repoFullName(repo);
    await this.#request('POST', `/repos/${name}/forks`, undefined, () => undefined, {}, { authorize: authorizeMutation });
  }

  async getBranchSha(repo: string, branch: string): Promise<string> {
    const name = repoFullName(repo), ref = branchName(branch);
    const result = await this.#request('GET', `/repos/${name}/git/ref/heads/${ref}`, undefined, value => value as Record<string, unknown>);
    const obj = result.object as Record<string, unknown> | undefined;
    return nonEmpty(obj?.sha, 64);
  }

  async createBranch(forkRepo: string, newBranch: string, fromSha: string, authorizeMutation: () => void): Promise<void> {
    const name = repoFullName(forkRepo), branch = branchName(newBranch);
    if (!/^[0-9a-f]{40}$/.test(fromSha)) fail('github_invalid_sha');
    await this.#request('POST', `/repos/${name}/git/refs`, undefined, () => undefined,
      { ref: `refs/heads/${branch}`, sha: fromSha }, { authorize: authorizeMutation });
  }

  /** Creates or updates a single file on the given branch of the fork. */
  async putFile(forkRepo: string, branch: string, filePath: string, content: string, message: string, authorizeMutation: () => void): Promise<void> {
    const name = repoFullName(forkRepo), ref = branchName(branch);
    const path = nonEmpty(filePath, 400).replace(/^\/+/, '');
    if (path.includes('..')) fail('github_invalid_path');
    let sha: string | undefined;
    try {
      const existing = await this.#request('GET', `/repos/${name}/contents/${path}`, { ref }, value => value as Record<string, unknown>);
      if (typeof existing.sha === 'string') sha = existing.sha;
    } catch (error) {
      if (!(error instanceof GithubBountyError && error.code === 'github_not_found')) throw error;
    }
    await this.#request('PUT', `/repos/${name}/contents/${path}`, undefined, () => undefined,
      { message: nonEmpty(message, 400), content: Buffer.from(content, 'utf8').toString('base64'), branch: ref, ...(sha ? { sha } : {}) },
      { authorize: authorizeMutation });
  }

  async createPullRequest(upstreamRepo: string, headOwner: string, headBranch: string, baseBranch: string,
    title: string, body: string, authorizeMutation: () => void): Promise<{ number: number; url: string; headSha: string }> {
    const name = repoFullName(upstreamRepo);
    const result = await this.#request('POST', `/repos/${name}/pulls`, undefined, value => value as Record<string, unknown>,
      { title: nonEmpty(title, 250), body: nonEmpty(body, 60000), head: `${nonEmpty(headOwner, 80)}:${branchName(headBranch)}`, base: branchName(baseBranch), maintainer_can_modify: true },
      { authorize: authorizeMutation });
    const head = result.head as Record<string, unknown> | undefined;
    return { number: issueNumber(result.number), url: nonEmpty(result.html_url, 400), headSha: nonEmpty(head?.sha, 64) };
  }

  async getPullRequest(repo: string, number: number): Promise<PullRequestProofRaw> {
    const name = repoFullName(repo), n = issueNumber(number);
    const result = await this.#request('GET', `/repos/${name}/pulls/${n}`, undefined, value => value as Record<string, unknown>);
    const head = result.head as Record<string, unknown> | undefined;
    const merged = result.merged === true;
    const state = merged ? 'merged' as const : result.state === 'closed' ? 'closed_unmerged' as const : 'open' as const;
    return { repoFullName: name, number: n, url: nonEmpty(result.html_url, 400), headSha: nonEmpty(head?.sha, 64), state, mergedAt: typeof result.merged_at === 'string' ? result.merged_at : null };
  }

  /** Read-only review/check snapshot for an already-opened PR. It reports only
   * what GitHub returned at this instant: `passing` means every *observed* run
   * passed, not that a repository's unknown branch-protection requirements are
   * satisfied. No review is submitted, dismissed, or interpreted as a payout. */
  async getPullRequestReviewSnapshot(repo: string, number: number): Promise<PullRequestReviewSnapshotRaw> {
    const pull = await this.getPullRequest(repo, number);
    const observedAt = new Date().toISOString();
    if (pull.state !== 'open') {
      return { ...pull, reviewState: 'not_applicable', checksState: 'not_applicable', reviewCount: 0, checkRunCount: 0, observedAt };
    }

    const reviews = await this.#request('GET', `/repos/${pull.repoFullName}/pulls/${pull.number}/reviews`, { per_page: '100' }, value => {
      if (!Array.isArray(value)) fail('github_invalid_response');
      return value as Record<string, unknown>[];
    });
    let approved = false, changesRequested = false, reviewCount = 0;
    for (const review of reviews.slice(0, 100)) {
      const state = typeof review.state === 'string' ? review.state.toUpperCase() : '';
      // A submitted review is evidence; bot/user identity and prose never need
      // to be stored locally to monitor the workflow safely.
      if (state === 'APPROVED') { approved = true; reviewCount++; }
      else if (state === 'CHANGES_REQUESTED') { changesRequested = true; reviewCount++; }
      else if (state === 'COMMENTED' || state === 'PENDING' || state === 'DISMISSED') reviewCount++;
    }
    // Conservative aggregation: an observed change request wins over an
    // observed approval because this endpoint does not prove the repository's
    // own approval/branch-protection rules or reviewer supersession semantics.
    const reviewState: PullRequestReviewState = changesRequested ? 'changes_requested' : approved ? 'approved' : 'review_pending';

    const checks = await this.#request('GET', `/repos/${pull.repoFullName}/commits/${pull.headSha}/check-runs`, { per_page: '100' }, value => {
      if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).check_runs)) fail('github_invalid_response');
      return (value as Record<string, unknown>).check_runs as Record<string, unknown>[];
    });
    const checkRunCount = checks.length;
    let pending = false, failing = false, allPassing = checkRunCount > 0;
    for (const check of checks.slice(0, 100)) {
      const status = typeof check.status === 'string' ? check.status.toLowerCase() : '';
      const conclusion = typeof check.conclusion === 'string' ? check.conclusion.toLowerCase() : '';
      if (status !== 'completed') { pending = true; allPassing = false; continue; }
      if (!['success', 'neutral', 'skipped'].includes(conclusion)) {
        // A completed check with an unknown/empty conclusion is deliberately
        // treated as pending rather than passed; explicit failure is retained.
        if (['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(conclusion)) failing = true;
        else pending = true;
        allPassing = false;
      }
    }
    const checksState: PullRequestChecksState = failing ? 'failing' : pending ? 'pending' : allPassing ? 'passing' : 'not_reported';
    return { ...pull, reviewState, checksState, reviewCount, checkRunCount, observedAt };
  }
}

export interface BountyLeadRaw { repoFullName: string; issueNumber: number; issueUrl: string; title: string; labels: string[]; hintedAmountCents: number | null; /** Body returned by GitHub search; optional for hand-authored classifier fixtures. */ issueBody?: string }
export interface PullRequestProofRaw { repoFullName: string; number: number; url: string; headSha: string; state: 'open' | 'merged' | 'closed_unmerged'; mergedAt: string | null }
export type PullRequestReviewState = 'approved' | 'changes_requested' | 'review_pending' | 'not_applicable';
export type PullRequestChecksState = 'passing' | 'failing' | 'pending' | 'not_reported' | 'not_applicable';
export interface PullRequestReviewSnapshotRaw extends PullRequestProofRaw {
  reviewState: PullRequestReviewState;
  checksState: PullRequestChecksState;
  reviewCount: number;
  checkRunCount: number;
  observedAt: string;
}
export interface RepoMetadataRaw { repoFullName: string; stargazersCount: number; forksCount: number; openIssuesCount: number; createdAt: string | null; archived: boolean; fork: boolean; defaultBranch?: string | null }
export interface BountyIssueDetailRaw { repoFullName: string; issueNumber: number; issueUrl: string; title: string; body: string; labels: string[] }
export interface LeadRiskRaw { accepted: boolean; reason: string | null }

/** Extract only an explicit USD amount from the issue body returned by GitHub.
 * Currency-free numbers, title text, and labels are intentionally ignored. */
export function extractDeclaredAmountCents(body: string): number | null {
  if (typeof body !== 'string' || body.length > 30000) return null;
  const amount = '([0-9]{1,9}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)(?![0-9])';
  const match = new RegExp(`(?:\\$\\s*${amount}|\\bUSD\\s*${amount}|\\b${amount}\\s*USD\\b)`, 'i').exec(body);
  if (!match) return null;
  const n = Number((match[1] ?? match[2] ?? match[3]).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
  return Math.round(n * 100);
}

/** Conservative, explicit deny-list based classifier. Silence defaults to
 * "disclosure required, owner must confirm" — never to unconditional permission. */
const BAN_PATTERNS = [
  /no\s+ai[\s-]?(generated|written|assisted)?\s*(contributions?|pull requests?|prs?)/i,
  /ai[\s-]?generated (contributions?|pull requests?|prs?)\s+(are\s+)?(not\s+accepted|banned|prohibited|disallowed)/i,
  /do\s+not\s+(use|submit)\s+ai/i,
  /bots?\s+are\s+not\s+(allowed|welcome|permitted)/i,
  /humans\s+only/i,
];
export function classifyRepoPolicy(repoFullNameValue: string, files: { path: string; content: string }[], nowIso: string): RepoPolicyProofRaw {
  let banned = false, source: string | null = null, excerpt = '';
  for (const file of files) {
    for (const pattern of BAN_PATTERNS) {
      const match = pattern.exec(file.content);
      if (match) { banned = true; source = file.path; excerpt = file.content.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80); break; }
    }
    if (banned) break;
  }
  if (!banned && files.length) { source = files[0].path; excerpt = files[0].content.slice(0, 200); }
  return { repoFullName: repoFullNameValue, aiContributionsAllowed: !banned, disclosureRequired: true, policySource: source, policyExcerpt: excerpt, checkedAt: nowIso };
}
export interface RepoPolicyProofRaw { repoFullName: string; aiContributionsAllowed: boolean; disclosureRequired: boolean; policySource: string | null; policyExcerpt: string; checkedAt: string }

/** Known bait/farm-repo naming patterns observed in the wild (repos created
 * specifically to bait autonomous agents into free labor, not real bounty
 * sponsors) — conservative and explicit, expanded only from confirmed cases,
 * never a guess at a legitimate maintainer's naming choice. */
const FARM_REPO_NAME_PATTERNS = [
  /bounty-?plaza/i,
  /agent-?bounties/i,
  /for-?ai-?agents?/i,
  /ai-?agents?-?only/i,
];
/** Prompt-injection / social-engineering phrases sometimes hidden in issue
 * titles or bodies aimed at automated agents — these are read-only inputs to
 * classification and are never obeyed. */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /do\s+not\s+(tell|inform|notify)\s+(the\s+)?(human|owner|maintainer)/i,
  /humans?\s+(are\s+)?not\s+allowed/i,
];
const MIN_REPO_AGE_DAYS_FOR_ZERO_STAR = 30;

/** Fraud/bait-repo risk screen run on every discovered lead BEFORE any work
 * is ever prepared. Conservative and explicit: only known bad patterns and a
 * factual young+zero-engagement signal reject a lead; everything else is
 * accepted for further (still owner-approved) review. Never rejects based on
 * legitimate maintainer identity, country, or any protected characteristic. */
export function classifyLeadRisk(lead: BountyLeadRaw, metadata: RepoMetadataRaw | null, duplicateTitleAcrossRepos: boolean): LeadRiskRaw {
  if (FARM_REPO_NAME_PATTERNS.some(p => p.test(lead.repoFullName))) return { accepted: false, reason: 'known_bait_or_farm_repo_name_pattern' };
  if (INJECTION_PATTERNS.some(p => p.test(lead.title))) return { accepted: false, reason: 'prompt_injection_phrasing_in_title' };
  if (duplicateTitleAcrossRepos) return { accepted: false, reason: 'duplicate_templated_title_across_unrelated_repos' };
  if (metadata) {
    if (metadata.archived) return { accepted: false, reason: 'repo_archived' };
    if (metadata.fork) return { accepted: false, reason: 'repo_is_a_fork_not_the_canonical_upstream' };
    if (metadata.stargazersCount === 0 && metadata.createdAt) {
      const ageDays = (Date.now() - Date.parse(metadata.createdAt)) / 86400000;
      if (Number.isFinite(ageDays) && ageDays < MIN_REPO_AGE_DAYS_FOR_ZERO_STAR) return { accepted: false, reason: 'new_zero_star_repo_high_risk' };
    }
  }
  return { accepted: true, reason: null };
}
/** Real anti-farm signal observed live: several bait repos post the exact
 * same templated issue title across many unrelated accounts/repos. */
export function detectDuplicateTitles(leads: readonly BountyLeadRaw[]): Set<string> {
  const byTitle = new Map<string, Set<string>>();
  for (const lead of leads) {
    const key = lead.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, new Set());
    byTitle.get(key)!.add(lead.repoFullName);
  }
  const duplicated = new Set<string>();
  for (const lead of leads) {
    const key = lead.title.trim().toLowerCase();
    if ((byTitle.get(key)?.size ?? 0) > 1) duplicated.add(`${lead.repoFullName}#${lead.issueNumber}`);
  }
  return duplicated;
}

export interface BountyLead { readonly kind: 'github_bounty_lead'; readonly repoFullName: string; readonly issueNumber: number; readonly issueUrl: string; readonly title: string; readonly labels: readonly string[]; readonly hintedAmountCents: number | null; readonly observedAt: string; readonly executable: false }

/** Explicit opt-in; a token here is the owner's OWN free GitHub identity/PAT,
 * never a new earning-platform account and never KYC. Discovery works even
 * without a token (unauthenticated GitHub search), just at a lower rate limit. */
export function configuredGithubBountyClient(env: Readonly<Record<string, string | undefined>> = process.env, dependencies: GithubClientDependencies = {}): GithubBountyClient {
  const token = env.ZA141251SA_GITHUB_TOKEN ?? null;
  return new GithubBountyClient({ accessToken: token }, dependencies);
}
