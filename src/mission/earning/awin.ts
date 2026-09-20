/**
 * Awin publisher API primitives, NOT an EarningProvider or MoneyProvider.
 * A programme is a lead, a link is not delivery, a commission is not treasury cash.
 * No registration/import-time network calls. See docs/REAL_EARNING_WORKFORCE.md.
 */
import { createHash } from 'node:crypto';

export class AwinError extends Error {
  constructor(public readonly code: string, public readonly effectMayHaveOccurred = false,
    public readonly retryAfterMs: number | null = null) { super(code); this.name = 'AwinError'; }
}
function fail(code = 'awin_invalid_response'): never { throw new AwinError(code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : fail(); }
function id(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return fail('awin_invalid_id');
  const result = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^[1-9]\d{0,18}$/.test(result) || BigInt(result) > 9223372036854775807n) return fail('awin_invalid_id');
  return result;
}
function text(value: unknown, max = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return fail();
  return value;
}
function https(value: unknown): URL {
  const raw = text(value, 4096);
  let url: URL;
  try { url = new URL(raw); } catch { return fail('awin_invalid_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return fail('awin_invalid_url');
  return url;
}
function unique<T>(rows: T[], key: (row: T) => string): T[] {
  if (new Set(rows.map(key)).size !== rows.length) return fail('awin_duplicate_evidence');
  return rows;
}

export interface AwinProgramLead {
  readonly kind: 'affiliate_program_lead';
  readonly publisherId: string;
  readonly advertiserId: string;
  readonly name: string;
  readonly status: 'active' | 'hidden';
  readonly observedAt: string;
  readonly executable: false;
}
export interface AwinTransactionEvidence {
  readonly kind: 'affiliate_transaction_evidence';
  readonly publisherId: string;
  readonly advertiserId: string;
  readonly transactionId: string;
  readonly commissionStatus: 'pending' | 'approved' | 'declined' | 'deleted';
  // Decimal provider value, NOT cents or available net cash. Never round into the ledger.
  readonly commissionAmount: { readonly decimal: string; readonly currency: string };
  readonly clickRef: string;
  readonly paidToPublisher: boolean;
  readonly paymentId: string | null;
  readonly observedAt: string;
  readonly treasurySettlement: 'unverified';
  readonly cashCreditEligible: false;
}

// Conservative single-process rolling limit shared by clients using the same token.
// Multi-process/user-wide coordination is still required before worker activation.
const limits = new Map<string, { starts: number[]; blockedUntil: number }>();
const MAX_BYTES = 2 * 1024 * 1024;
const WINDOW_MS = 60000;

export interface AwinClientDependencies { fetch?: typeof fetch; now?: () => number; beforeRequest?: () => void; onRateLimit?: (delayMs: number) => void }

export class AwinPublisherClient {
  readonly publisherId: string;
  #token: string;
  #key: string;
  #fetch: typeof fetch;
  #now: () => number;
  #beforeRequest?: () => void;
  #onRateLimit?: (delayMs: number) => void;
  constructor(config: { publisherId: string; accessToken: string },
    dependencies: AwinClientDependencies = {}) {
    this.publisherId = id(config.publisherId);
    if (typeof config.accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]+=*$/.test(config.accessToken) || config.accessToken.length > 8192) fail('awin_credentials_required');
    this.#token = config.accessToken;
    this.#key = createHash('sha256').update(this.#token).digest('hex');
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#now = dependencies.now ?? Date.now;
    this.#beforeRequest = dependencies.beforeRequest;
    this.#onRateLimit = dependencies.onRateLimit;
  }

  #reserveRequest(): void {
    const now = this.#now();
    const state = limits.get(this.#key) ?? { starts: [], blockedUntil: 0 };
    state.starts = state.starts.filter(t => now - t < WINDOW_MS);
    limits.set(this.#key, state);
    if (now < state.blockedUntil) throw new AwinError('awin_rate_limited', false, state.blockedUntil - now);
    if (state.starts.length >= 20) throw new AwinError('awin_rate_limited', false, Math.max(1, WINDOW_MS - (now - state.starts[0])));
    state.starts.push(now);
  }

  async #request<T>(path: string, query: Record<string, string>, parse: (value: unknown) => T,
    signal?: AbortSignal, mutation?: { body: unknown; authorize: () => void }): Promise<T> {
    const combined = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
    if (combined.aborted) throw new AwinError('awin_cancelled');
    this.#reserveRequest();
    this.#beforeRequest?.();
    // Caller must bind this to current owner/assignment/freeze/approval checks.
    mutation?.authorize();
    if (combined.aborted) throw new AwinError('awin_cancelled');
    const url = new URL(path, 'https://api.awin.com');
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response | undefined;
    try {
      response = await this.#fetch(url, { method: mutation ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
        ...(mutation ? { body: JSON.stringify(mutation.body) } : {}), signal: combined });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const duration = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.#now() : NaN;
        const delay = Number.isSafeInteger(duration) && duration > 0 ? Math.max(WINDOW_MS, duration) : WINDOW_MS;
        limits.get(this.#key)!.blockedUntil = this.#now() + delay;
        this.#onRateLimit?.(delay);
        throw new AwinError('awin_rate_limited', !!mutation, delay);
      }
      if (response.status === 401 || response.status === 403) throw new AwinError('awin_access_denied');
      if (response.status !== 200) throw new AwinError('awin_http_failure', !!mutation);
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) fail();
      const reader = response.body?.getReader();
      if (!reader) fail();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) fail('awin_response_too_large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return parse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    } catch (error) {
      // Never propagate tokens, request URLs, response bodies or transport error causes.
      if (error instanceof AwinError) {
        if (mutation && response?.status === 200) throw new AwinError(error.code, true, error.retryAfterMs);
        throw error;
      }
      throw new AwinError('awin_transport_or_parse_failure', !!mutation);
    } finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }

  async discoverJoinedPrograms(signal?: AbortSignal): Promise<AwinProgramLead[]> {
    return this.#request(`/publishers/${this.publisherId}/programmes`, { relationship: 'joined' }, value =>
      unique(array(value).map(item => {
        const row = object(item);
        if (row.status !== 'active' && row.status !== 'hidden') return fail();
        return { kind: 'affiliate_program_lead' as const, publisherId: this.publisherId,
          advertiserId: id(row.id), name: text(row.name), status: row.status,
          observedAt: new Date(this.#now()).toISOString(), executable: false as const };
      }), row => row.advertiserId), signal);
  }

  /** Fresh authorized relationship check; never treats catalog terms as eligibility. */
  async assertEligible(input: { advertiserId: string; destinationUrl: string }, signal?: AbortSignal): Promise<void> {
    const advertiserId = id(input.advertiserId), destination = https(input.destinationUrl);
    await this.#request(`/publishers/${this.publisherId}/programmedetails`, { advertiserId, relationship: 'joined' }, value => {
      const info = object(object(value).programmeInfo);
      if (id(info.id) !== advertiserId || info.membershipStatus !== 'Joined' || info.deeplinkEnabled !== true ||
        (info.linkStatus !== undefined && info.linkStatus !== 'online')) fail('awin_program_not_eligible');
      const domains = array(info.validDomains).map(domain => text(object(domain).domain).toLowerCase());
      if (!domains.includes(destination.hostname.toLowerCase())) fail('awin_destination_not_allowed');
    }, signal);
  }

  async createTrackingLink(input: { advertiserId: string; destinationUrl: string; clickRef: string },
    authorizeMutation: () => void, signal?: AbortSignal): Promise<{ state: 'link_created_not_published'; url: string }> {
    const advertiserId = id(input.advertiserId);
    const numericId = Number(advertiserId);
    if (!Number.isSafeInteger(numericId)) fail('awin_invalid_id');
    const destination = https(input.destinationUrl);
    const clickRef = input.clickRef;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(clickRef)) fail('awin_invalid_click_ref');
    if (typeof authorizeMutation !== 'function') fail('awin_authorization_required');
    await this.assertEligible({ advertiserId, destinationUrl: destination.href }, signal);
    return this.#request(`/publishers/${this.publisherId}/linkbuilder/generate`, {}, value => {
      const url = https(object(value).url);
      if (url.href.includes(this.#token) || url.href.includes(encodeURIComponent(this.#token)) ||
        ['awinaffid', 'awinmid', 'clickref'].some(key => url.searchParams.getAll(key).length !== 1) ||
        !['www.awin1.com', 'awin1.com'].includes(url.hostname) ||
        url.searchParams.get('awinaffid') !== this.publisherId || url.searchParams.get('awinmid') !== advertiserId ||
        url.searchParams.get('clickref') !== clickRef) fail('awin_link_identity_mismatch');
      return { state: 'link_created_not_published' as const, url: url.href };
    }, signal, { authorize: authorizeMutation, body: { advertiserId: numericId, destinationUrl: destination.href,
      parameters: { clickref: clickRef }, shorten: false } });
  }

  async transactionsByIds(input: { ids: readonly string[]; advertiserId: string; clickRef: string }, signal?: AbortSignal):
    Promise<{ transactions: AwinTransactionEvidence[]; unreturnedIds: string[] }> {
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100) fail('awin_invalid_transaction_batch');
    const ids = input.ids.map(id);
    unique(ids, value => value);
    return this.#transactions(input, { ids: ids.join(','), timezone: 'UTC' }, ids, signal);
  }

  async transactionsForWindow(input: { advertiserId: string; clickRef: string; startDate: string; endDate: string }, signal?: AbortSignal) {
    const start = Date.parse(input.startDate), end = Date.parse(input.endDate);
    if (![input.startDate, input.endDate].every(s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000) fail('awin_invalid_date_window');
    return this.#transactions(input, { advertiserId: id(input.advertiserId), startDate: input.startDate,
      endDate: input.endDate, timezone: 'UTC', dateType: 'transaction' }, null, signal);
  }

  async #transactions(input: { advertiserId: string; clickRef: string }, query: Record<string, string>, ids: string[] | null, signal?: AbortSignal) {
    const advertiserId = id(input.advertiserId), clickRef = text(input.clickRef, 64);
    return this.#request(`/publishers/${this.publisherId}/transactions`, query, value => {
      const selected = array(value).filter(item => {
        const row = object(item);
        if (id(row.publisherId) !== this.publisherId || id(row.advertiserId) !== advertiserId) fail('awin_transaction_identity_mismatch');
        return ids !== null || object(row.clickRefs).clickRef === clickRef;
      });
      const transactions = unique(selected.map((item): AwinTransactionEvidence => {
        const row = object(item), transactionId = id(row.id);
        if ((ids !== null && !ids.includes(transactionId)) || id(row.publisherId) !== this.publisherId || id(row.advertiserId) !== advertiserId ||
          object(row.clickRefs).clickRef !== clickRef) fail('awin_transaction_identity_mismatch');
        const status = row.commissionStatus;
        if (status !== 'pending' && status !== 'approved' && status !== 'declined' && status !== 'deleted') return fail();
        const amount = object(row.commissionAmount);
        if (typeof amount.amount !== 'string' && typeof amount.amount !== 'number') fail();
        if (typeof amount.amount === 'number' && (!Number.isFinite(amount.amount) || Math.abs(amount.amount) > Number.MAX_SAFE_INTEGER)) fail();
        const decimal = String(amount.amount), currency = text(amount.currency, 3);
        if (!/^-?(0|[1-9]\d{0,15})(\.\d{1,6})?$/.test(decimal) || !/^[A-Z]{3}$/.test(currency) || typeof row.paidToPublisher !== 'boolean') fail();
        const paymentId = row.paymentId === 0 || row.paymentId === '0' || row.paymentId === null ? null : id(row.paymentId);
        if (row.paidToPublisher && !paymentId) fail('awin_payment_reference_missing');
        return { kind: 'affiliate_transaction_evidence' as const, publisherId: this.publisherId, advertiserId,
          transactionId, commissionStatus: status, commissionAmount: { decimal, currency }, clickRef,
          paidToPublisher: row.paidToPublisher as boolean, paymentId, observedAt: new Date(this.#now()).toISOString(),
          treasurySettlement: 'unverified' as const, cashCreditEligible: false as const };
      }), row => row.transactionId);
      return { transactions, unreturnedIds: (ids ?? []).filter(requested => !transactions.some(row => row.transactionId === requested)) };
    }, signal);
  }
}

/** Explicit opt-in; credentials never fall back to customer/platform configuration. */
export function configuredAwinClient(env: Readonly<Record<string, string | undefined>> = process.env, dependencies: AwinClientDependencies = {}): AwinPublisherClient | null {
  if (env.ZA141251SA_AWIN_ENABLED !== 'true') return null;
  if (!env.ZA141251SA_AWIN_PUBLISHER_ID || !env.ZA141251SA_AWIN_ACCESS_TOKEN) fail('awin_credentials_required');
  return new AwinPublisherClient({ publisherId: env.ZA141251SA_AWIN_PUBLISHER_ID!, accessToken: env.ZA141251SA_AWIN_ACCESS_TOKEN! }, dependencies);
}
