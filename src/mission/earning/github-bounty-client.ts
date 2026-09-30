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

export interface GithubClientDependencies { fetch?: typeof fetch; now?: () => number; beforeRequest?: () => void; onRateLimit?: (delayMs: number) => void }

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
        seen.set(key, { repoFullName: repo, issueNumber: number, issueUrl: nonEmpty(item.html_url, 400), title, labels, hintedAmountCents: hintAmountCents(title, labels) });
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
}

export interface BountyLeadRaw { repoFullName: string; issueNumber: number; issueUrl: string; title: string; labels: string[]; hintedAmountCents: number | null }
export interface PullRequestProofRaw { repoFullName: string; number: number; url: string; headSha: string; state: 'open' | 'merged' | 'closed_unmerged'; mergedAt: string | null }

function hintAmountCents(title: string, labels: readonly string[]): number | null {
  const haystack = `${title} ${labels.join(' ')}`;
  const match = /\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/.exec(haystack);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
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

export interface BountyLead { readonly kind: 'github_bounty_lead'; readonly repoFullName: string; readonly issueNumber: number; readonly issueUrl: string; readonly title: string; readonly labels: readonly string[]; readonly hintedAmountCents: number | null; readonly observedAt: string; readonly executable: false }

/** Explicit opt-in; a token here is the owner's OWN free GitHub identity/PAT,
 * never a new earning-platform account and never KYC. Discovery works even
 * without a token (unauthenticated GitHub search), just at a lower rate limit. */
export function configuredGithubBountyClient(env: Readonly<Record<string, string | undefined>> = process.env, dependencies: GithubClientDependencies = {}): GithubBountyClient {
  const token = env.ZA141251SA_GITHUB_TOKEN ?? null;
  return new GithubBountyClient({ accessToken: token }, dependencies);
}
