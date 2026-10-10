/**
 * Frantic board reader — a second bounty venue, read-only by construction.
 *
 * WHY. The GitHub-issue bounty path assumes the issue *is* the contract: labels carry the
 * price, comments carry the hand-out, and a pull request is the delivery. That is true for
 * ordinary OSS bounties and false for agent-native venues that mirror their board into
 * GitHub issues as a courtesy. One such venue publishes a machine-readable board
 * (`GET /v1/board`), a machine-readable economy (`GET /v1/policy`), per-bounty claim gates,
 * and a public receipt ledger where payout is sealed to a receipt rather than to our own
 * ledger. Its own instructions are explicit: "Do not use issue comments or social threads
 * as the … board protocol." A discovery pass that read the mirrored GitHub issues and then
 * opened a pull request would be working the wrong contract on the wrong surface — so the
 * mirrored issues are deliberately not treated as claimable work here.
 *
 * WHAT THIS MODULE DOES NOT DO. It performs no write: no signup, no claim, no delivery, no
 * payout setup. Registration means creating an account on someone else's platform with the
 * owner's email and GitHub handle, and every claim on the venue today is gated on a verified
 * human identity; that is an owner action, not an agent action. This module therefore reads
 * the board, classifies each open bounty against *our* policy, and stops.
 *
 * Fail-closed rules carried over from the GitHub path: an unreadable board is an error, not
 * an empty list; a bounty with no acceptance text is `unverifiable`; and a verdict is only
 * as good as the quoted evidence attached to it.
 */

/** The only host this reader will talk to. Nothing is fetched from board content. */
export const FRANTIC_HOST = 'gofrantic.com';
export const FRANTIC_READ_PATHS = ['/v1/board', '/v1/policy'] as const;
/** Bounded so a hostile or oversized payload cannot inflate the audit. */
export const MAX_BOARD_BYTES = 4_000_000;
export const MAX_NOTE_BYTES = 20_000;
export const MAX_BOUNTIES_PER_READ = 100;

export type FranticRefusalCode =
  | 'frantic_transport_failure'
  | 'frantic_host_denied'
  | 'frantic_method_denied'
  | 'frantic_response_too_large'
  | 'frantic_invalid_response';

export class FranticBoardError extends Error {
  readonly code: FranticRefusalCode;
  readonly retryAfterMs: number | null;
  constructor(code: FranticRefusalCode, retryAfterMs: number | null = null) {
    super(code);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Third-party surfaces where an automated post is the *worker's* act, not the venue's. */
const EXTERNAL_PLATFORM_POSTING = [
  'reddit', 'twitter', ' x ', 'facebook', 'linkedin', 'medium.com', 'quora', 'hacker news',
  'answer live', 'comment on', 'reply on', 'citation', 'backlink', 'upvote',
];
/** Work that only makes sense if the operator spends their own money first. */
const OWNER_FUNDED_OR_REBATE = ['rebate', 'on the house', 'fund it', 'funding receipt', 'first five', 'post a bounty', 'vendor posting'];
/** Terms we will not sign on an owner's behalf. */
const KYC_OR_IDENTITY_TERMS = ['kyc', 'identity verification', 'government id', 'passport', 'driver license', 'date of birth'];

export interface FranticClaimGate {
  readonly available: boolean;
  readonly state: string;
  readonly reason: string;
  readonly requires: readonly string[];
}

export interface FranticBoardBounty {
  readonly number: number;
  readonly title: string;
  readonly visibility: string;
  readonly priceUsdCents: number;
  readonly funded: boolean;
  readonly workStatus: string;
  readonly note: string;
  readonly slotsAvailable: number;
  readonly url: string;
  readonly apiUrl: string;
  readonly claim: FranticClaimGate | null;
}

export interface FranticPolicy {
  readonly rentCentsPerDay: number | null;
  readonly welcomeRunwayDays: number | null;
  readonly maxRunwayDays: number | null;
  readonly liveCapCents: number | null;
}

export type FranticScreen = 'eligible_for_agent_work' | 'blocked_by_owner_action' | 'refused_policy' | 'unverifiable';

export interface FranticScreenResult {
  readonly screen: FranticScreen;
  readonly reasons: readonly string[];
  readonly evidence: readonly string[];
  readonly ownerActions: readonly string[];
}

function str(value: unknown, limit = 400): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function boundedNote(value: unknown): string {
  const text = str(value, MAX_NOTE_BYTES);
  return text.length >= MAX_NOTE_BYTES ? text.slice(0, MAX_NOTE_BYTES) : text;
}

/**
 * Parse one board row. Every field is read defensively: the board is external content, so a
 * row that does not look like a bounty is dropped rather than trusted, and a row with a
 * missing price or a closed slot list never becomes `eligible_for_agent_work`.
 */
export function parseBoardBounty(input: unknown): FranticBoardBounty | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const number = num(row.number);
  if (number === null || !Number.isInteger(number) || number <= 0) return null;
  const title = str(row.title, 300);
  if (!title) return null;
  const price = num(row.price_usd);
  const slots = (row.claim_slots && typeof row.claim_slots === 'object' ? row.claim_slots : {}) as Record<string, unknown>;
  const actions = (row.actions && typeof row.actions === 'object' ? row.actions : {}) as Record<string, unknown>;
  const claimRow = (actions.claim && typeof actions.claim === 'object' ? actions.claim : null) as Record<string, unknown> | null;
  return {
    number,
    title,
    visibility: str(row.visibility, 20) || 'unknown',
    priceUsdCents: price === null ? -1 : Math.round(price * 100),
    funded: row.funded === true,
    workStatus: str(row.work_status, 40) || 'unknown',
    note: boundedNote(row.note),
    slotsAvailable: num(slots.available) ?? 0,
    url: str(row.url, 300),
    apiUrl: str(row.api_url, 300),
    claim: claimRow
      ? {
        available: claimRow.available === true,
        state: str(claimRow.state, 60) || 'unknown',
        reason: str(claimRow.reason, 400),
        requires: Array.isArray(claimRow.requires) ? (claimRow.requires as unknown[]).map(entry => str(entry, 80)).filter(Boolean) : [],
      }
      : null,
  };
}

export function parseBoard(payload: unknown): { bounties: FranticBoardBounty[]; stats: Record<string, unknown> } {
  if (!payload || typeof payload !== 'object') throw new FranticBoardError('frantic_invalid_response');
  const root = payload as Record<string, unknown>;
  if (root.ok !== true) throw new FranticBoardError('frantic_invalid_response');
  const board = (root.board && typeof root.board === 'object' ? root.board : null) as Record<string, unknown> | null;
  if (!board || !Array.isArray(board.open_bounties)) throw new FranticBoardError('frantic_invalid_response');
  const bounties = board.open_bounties
    .slice(0, MAX_BOUNTIES_PER_READ)
    .map(parseBoardBounty)
    .filter((entry): entry is FranticBoardBounty => entry !== null);
  const stats: Record<string, unknown> = {};
  for (const key of ['founded', 'day', 'live', 'bounties_open', 'operators_enlisted', 'sworn_count']) {
    if (board[key] !== undefined) stats[key] = typeof board[key] === 'string' ? str(board[key], 40) : (board[key] as unknown);
  }
  for (const key of ['funded_usd', 'season_total_usd', 'moved_usd']) {
    const value = num(board[key]);
    if (value !== null) stats[key] = value;
  }
  return { bounties, stats };
}

export function parsePolicy(payload: unknown): FranticPolicy {
  const policy = ((payload as Record<string, unknown> ?? {}).policy ?? {}) as Record<string, unknown>;
  return {
    rentCentsPerDay: num(policy.rent_cents_per_day),
    welcomeRunwayDays: num(policy.welcome_runway_days),
    maxRunwayDays: num(policy.max_runway_days),
    liveCapCents: num(policy.live_cap_cents),
  };
}

/**
 * Screen one board row against this fleet's standing rules.
 *
 * The venue's own gate (`claim.available`/`state`) is not the only gate that matters: a
 * bounty whose deliverable is an automated post on a third-party platform asks us to accept
 * another site's rules on the owner's account, and a rebate-for-funding bounty requires the
 * owner to spend money first. Neither is agent work; both are owner decisions. Everything
 * else is still refused unless the acceptance text exists — a task we cannot check is a
 * task we cannot honestly price.
 */
export function screenFranticBounty(bounty: FranticBoardBounty, options: { paidTierUnlocked?: boolean } = {}): FranticScreenResult {
  const reasons: string[] = [];
  const evidence: string[] = [];
  const ownerActions: string[] = [];
  const haystack = `${bounty.title} ${bounty.note}`.toLowerCase();
  const quote = (needle: string, label: string) => {
    const index = haystack.indexOf(needle);
    if (index >= 0) evidence.push(`${label}: "${haystack.slice(Math.max(0, index), index + 90).trim()}…"`);
  };

  if (!bounty.funded) reasons.push('not_funded');
  if (bounty.priceUsdCents < 0) reasons.push('price_unreadable');
  if (bounty.slotsAvailable <= 0) reasons.push('no_open_slots');
  if (bounty.workStatus !== 'open') reasons.push(`work_status_${bounty.workStatus}`);
  if (!bounty.note.trim()) reasons.push('acceptance_text_absent');

  const external = EXTERNAL_PLATFORM_POSTING.find(entry => haystack.includes(entry.trim().toLowerCase()));
  if (external) {
    reasons.push('deliverable_is_a_post_on_another_platform');
    quote(external.trim().toLowerCase(), 'external_platform');
    ownerActions.push('owner decides whether automated posting on that platform is permitted there, and on which account');
  }
  const rebate = OWNER_FUNDED_OR_REBATE.find(entry => haystack.includes(entry));
  if (rebate) {
    reasons.push('requires_owner_funding_or_rebate');
    quote(rebate, 'funding_term');
    ownerActions.push('this bounty pays for money the owner would have to spend first; no activation or purchase is made without explicit owner approval');
  }
  const kyc = KYC_OR_IDENTITY_TERMS.find(entry => haystack.includes(entry));
  if (kyc) {
    reasons.push('terms_mention_identity_or_kyc');
    quote(kyc, 'identity_term');
    ownerActions.push('any identity or KYC step is a human action performed by the owner, never by an agent');
  }

  const gate = bounty.claim;
  if (gate) {
    if (gate.state && gate.state !== 'open') {
      reasons.push(`claim_gate_${gate.state}`);
      if (gate.reason) evidence.push(`claim_gate: ${gate.reason}`);
    }
    if (gate.requires.some(entry => entry.includes('eligible_operator_or_successful_paid_bounty')) && options.paidTierUnlocked !== true) {
      reasons.push('paid_tier_requires_prior_settled_bounty');
      ownerActions.push('the venue unlocks the larger tier after one settled paid bounty or an established GitHub operator account — the owner decides which proof to present');
    }
    if (gate.available !== true) reasons.push('claim_unavailable');
  } else {
    reasons.push('claim_gate_unreadable');
  }

  const screen: FranticScreen = reasons.length === 0
    ? 'eligible_for_agent_work'
    : (reasons.some(reason => reason === 'deliverable_is_a_post_on_another_platform'
      || reason === 'requires_owner_funding_or_rebate'
      || reason === 'terms_mention_identity_or_kyc'))
      ? 'refused_policy'
      : (reasons.some(reason => reason.startsWith('claim_gate_requires_identity') || reason === 'claim_gate_unverified_identity'
        || reason === 'paid_tier_requires_prior_settled_bounty' || reason === 'claim_unavailable')
        ? 'blocked_by_owner_action'
        : 'unverifiable');
  if (screen === 'blocked_by_owner_action' && ownerActions.length === 0) {
    ownerActions.push('register/enlist the agent on the venue with the owner email and GitHub handle, then verify the identity link — no agent may create the account');
  }
  return { screen, reasons, evidence, ownerActions };
}

export interface FranticReadResult {
  readonly board: { bounties: FranticBoardBounty[]; stats: Record<string, unknown> };
  readonly policy: FranticPolicy;
  readonly asOf: string;
}

export interface FranticDependencies {
  fetch?: (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
  now?: () => number;
}

/** Read-only client. Any attempt to use another method or host is refused before I/O. */
export function createFranticBoardClient(deps: FranticDependencies = {}) {
  const candidate = deps.fetch ?? (globalThis as { fetch?: FranticDependencies['fetch'] }).fetch;
  if (!candidate) throw new FranticBoardError('frantic_transport_failure');
  const fetchImpl: NonNullable<FranticDependencies['fetch']> = candidate;
  const now = deps.now ?? (() => Date.now());

  async function get(path: string): Promise<unknown> {
    if (path !== '/v1/board' && path !== '/v1/policy' && !path.startsWith('/v1/bounties/')) {
      throw new FranticBoardError('frantic_invalid_response');
    }
    const url = new URL(`https://${FRANTIC_HOST}${path}`);
    if (url.host !== FRANTIC_HOST) throw new FranticBoardError('frantic_host_denied');
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'akbaral-mission-board-reader' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new FranticBoardError('frantic_transport_failure', null);
    const size = Number(response.headers.get('content-length') ?? '0');
    if (size > MAX_BOARD_BYTES) throw new FranticBoardError('frantic_response_too_large');
    const text = await response.text();
    if (text.length > MAX_BOARD_BYTES) throw new FranticBoardError('frantic_response_too_large');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new FranticBoardError('frantic_invalid_response');
    }
  }

  return {
    methodAllowed: () => false as const,
    async read(): Promise<FranticReadResult> {
      const [boardPayload, policyPayload] = await Promise.all([get('/v1/board'), get('/v1/policy')]);
      return {
        board: parseBoard(boardPayload),
        policy: parsePolicy(policyPayload),
        asOf: new Date(now()).toISOString(),
      };
    },
    async readBounty(reference: string): Promise<Record<string, unknown> | null> {
      const safe = reference.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
      if (!safe) return null;
      const payload = await get(`/v1/bounties/${encodeURIComponent(safe)}`) as Record<string, unknown>;
      return payload && typeof payload === 'object' ? payload : null;
    },
  };
}
