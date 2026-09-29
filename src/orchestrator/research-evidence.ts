/**
 * Evidence rules for externally sourced ("research") answers.
 *
 * Production defect this exists to prevent (live smoke test, gold price):
 * a request for the CURRENT price returned 2024 figures, quoted two
 * materially different dates (October 24, 2024 and May 22, 2024) as if both
 * described the same current value, and named sources without a single
 * verifiable URL. Nothing in the verification stage could see any of that.
 *
 * Everything here is deterministic and evidence-based:
 *   - currency intent is read from the USER'S OWN wording;
 *   - dates are parsed out of the model's own output — never invented;
 *   - a claim is only accepted as current when the output itself carries a
 *     date that IS current relative to the run clock;
 *   - conflicts are reported from the output's own numbers.
 *
 * No rule here can turn a failure into a pass: each function reports what it
 * found, and the verifier decides. When current data genuinely cannot be
 * obtained, the honest outcome is a failed verification (and a refunded free
 * task) — never a historical value relabelled as current.
 */

export type CurrencyIntent = 'today' | 'current' | null;

/** Wording that means "the value must be current", strongest first. */
const TODAY_PATTERN =
  /\b(today'?s?|right now|as of now|at this moment|live|real[\s-]?time|this (?:morning|afternoon|evening)|current(?:ly)? price today)\b/i;
const CURRENT_PATTERN =
  /\b(current(?:ly)?|latest|newest|most recent|up[\s-]?to[\s-]?date|now|this (?:week|month)|today)\b/i;

/**
 * The user's own words, with platform-injected context removed.
 *
 * Goals reaching the executor can carry appended platform blocks — e.g.
 * "[CURRENT PROJECT ARTIFACT v1 - the existing website HTML ...]" followed by
 * the document itself. Those words are ours, not the user's: reading intent
 * from them made a website edit look like a request for live market data.
 */
export function userRequestText(goal: string): string {
  return goal
    .split(/\n\s*\[[A-Z]/)[0]
    .split(/<!doctype html|<html[\s>]/i)[0]
    .replace(/<[^>]+>/g, ' ')
    .slice(0, 4000);
}

/**
 * Does the request demand current data? 'today' is the strict tier (same-day
 * data), 'current' the looser one (days-old data may still be defensible).
 * Intent is read ONLY from the user's own request text.
 */
export function detectCurrencyIntent(rawGoal: string): CurrencyIntent {
  const goal = userRequestText(rawGoal);
  if (TODAY_PATTERN.test(goal)) {
    return 'today';
  }
  if (CURRENT_PATTERN.test(goal)) {
    return 'current';
  }
  return null;
}

/** Maximum age, in days, of the newest evidence date for each intent tier. */
export const MAX_EVIDENCE_AGE_DAYS: Record<Exclude<CurrencyIntent, null>, number> = {
  today: 2,
  current: 7,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

export interface ParsedDate {
  /** The exact text found in the output — quoted back verbatim in evidence. */
  raw: string;
  /** UTC midnight of the parsed day. */
  date: Date;
}

function pushDate(into: ParsedDate[], raw: string, year: number, month: number, day: number): void {
  if (year < 1900 || year > 2999 || month < 0 || month > 11 || day < 1 || day > 31) {
    return;
  }
  const date = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== day) {
    return;
  }
  into.push({ raw, date });
}

/**
 * Every calendar date the output states, in the formats a model actually
 * produces. Only real, parseable dates are returned — no guessing.
 */
export function extractDates(content: string): ParsedDate[] {
  const found: ParsedDate[] = [];

  for (const match of content.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    pushDate(found, match[0], Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  // "October 24, 2024" / "Oct 24 2024"
  for (const match of content.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month !== undefined) {
      pushDate(found, match[0], Number(match[3]), month, Number(match[2]));
    }
  }
  // "24 October 2024"
  for (const match of content.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[match[2].toLowerCase()];
    if (month !== undefined) {
      pushDate(found, match[0], Number(match[3]), month, Number(match[1]));
    }
  }

  const unique = new Map<number, ParsedDate>();
  for (const entry of found) {
    if (!unique.has(entry.date.getTime())) {
      unique.set(entry.date.getTime(), entry);
    }
  }
  return [...unique.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

const DAY_MS = 86_400_000;

export function ageInDays(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

export interface FreshnessAssessment {
  intent: CurrencyIntent;
  dates: ParsedDate[];
  newest: ParsedDate | null;
  ageDays: number | null;
  /** 'ok' | 'no_date' | 'stale' | 'future' */
  verdict: 'ok' | 'no_date' | 'stale' | 'future';
  maxAgeDays: number | null;
}

/** Can the output's own dates establish that its data is current? */
export function assessFreshness(goal: string, content: string, now: Date): FreshnessAssessment {
  const intent = detectCurrencyIntent(goal);
  const dates = extractDates(content);
  if (intent === null) {
    return { intent, dates, newest: null, ageDays: null, verdict: 'ok', maxAgeDays: null };
  }
  const maxAgeDays = MAX_EVIDENCE_AGE_DAYS[intent];
  if (dates.length === 0) {
    return { intent, dates, newest: null, ageDays: null, verdict: 'no_date', maxAgeDays };
  }
  const newest = dates[dates.length - 1];
  const ageDays = ageInDays(newest.date, now);
  if (ageDays < -1) {
    return { intent, dates, newest, ageDays, verdict: 'future', maxAgeDays };
  }
  return { intent, dates, newest, ageDays, verdict: ageDays > maxAgeDays ? 'stale' : 'ok', maxAgeDays };
}

const URL_GLOBAL = /https?:\/\/[^\s)<>"'\]]+/gi;

export function extractUrls(content: string): string[] {
  return [...new Set((content.match(URL_GLOBAL) ?? []).map((url) => url.replace(/[.,;:]+$/, '')))];
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export interface SourceEvidenceAssessment {
  urls: string[];
  /** Cited hosts that also appear in the real retrieved tool context. */
  corroborated: string[];
  /** Cited hosts absent from the retrieved context (unverifiable here). */
  uncorroborated: string[];
  /** True when the output names sources in prose but gives no URL at all. */
  namedWithoutUrl: boolean;
}

/** Prose that credits a source without linking it ("according to X", "Source: X"). */
const NAMED_SOURCE_PATTERN =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?sources?(?:\*\*)?\s*[:\-]?\s*$|(?:^|\n)\s*(?:\*\*)?sources?(?:\*\*)?\s*[:\-]\s*\S|\baccording to\s+\w|\bper the\s+\w|\bdata from\s+\w|\bcited from\s+\w/im;

/**
 * Compare the output's citations with the context real tools retrieved.
 * `sourceContext` is the verbatim tool output; a citation is corroborated when
 * its host appears there. Nothing is invented: absence is reported as absence.
 */
export function assessSourceEvidence(content: string, sourceContext?: string | null): SourceEvidenceAssessment {
  const urls = extractUrls(content);
  const contextHosts = new Set(
    (sourceContext ? extractUrls(sourceContext) : []).map(hostOf).filter((host): host is string => host !== null),
  );
  const corroborated: string[] = [];
  const uncorroborated: string[] = [];
  for (const url of urls) {
    const host = hostOf(url);
    if (host === null) {
      continue;
    }
    if (contextHosts.size > 0 && contextHosts.has(host)) {
      corroborated.push(url);
    } else if (contextHosts.size > 0) {
      uncorroborated.push(url);
    }
  }
  return {
    urls,
    corroborated,
    uncorroborated,
    namedWithoutUrl: urls.length === 0 && NAMED_SOURCE_PATTERN.test(content),
  };
}

/** Wording that shows the output itself surfaced a disagreement to the reader. */
const RECONCILED_PATTERN =
  /\b(conflict|conflicting|discrepan|inconsisten|contradict|disagree|differs?\s+from|superseded|outdated|older\s+figure|varies?\s+(?:by|between)|range\s+(?:from|of)|different\s+sources)\b/i;

export interface ValueConflict {
  kind: 'date' | 'value';
  detail: string;
}

const UNIT_VALUE_PATTERN =
  /(?:(usd|pkr|rs|inr|eur|gbp|\$|£|€)\s*)?([\d][\d,]*(?:\.\d+)?)\s*(?:(usd|pkr|rs|inr|eur|gbp|dollars?|rupees?)\s*)?(?:per|\/)\s*(gram|g|grams|tola|ounce|oz|troy\s+ounce|kg|kilogram|barrel|litre|liter|share|unit)\b/gi;

function normaliseUnit(unit: string): string {
  const key = unit.toLowerCase().replace(/\s+/g, ' ').trim();
  if (key === 'g' || key === 'grams') return 'gram';
  if (key === 'oz' || key === 'troy ounce') return 'ounce';
  if (key === 'kilogram') return 'kg';
  if (key === 'liter') return 'litre';
  return key;
}

/** Relative gap above which two quotes for the same unit are a real conflict. */
export const MATERIAL_VALUE_GAP = 0.02;
/** Day spread above which two evidence dates describe different snapshots. */
export const MATERIAL_DATE_SPREAD_DAYS = 7;

/**
 * Materially conflicting claims inside one answer: two evidence dates far
 * apart, or two prices for the same currency+unit that differ by more than
 * MATERIAL_VALUE_GAP. Conflicts the output itself calls out (reconciliation
 * wording) are not reported — reporting a conflict honestly is allowed.
 */
export function detectConflicts(content: string): ValueConflict[] {
  if (RECONCILED_PATTERN.test(content)) {
    return [];
  }
  const conflicts: ValueConflict[] = [];

  const dates = extractDates(content);
  if (dates.length >= 2) {
    const oldest = dates[0];
    const newest = dates[dates.length - 1];
    const spread = Math.round((newest.date.getTime() - oldest.date.getTime()) / DAY_MS);
    if (spread > MATERIAL_DATE_SPREAD_DAYS) {
      conflicts.push({
        kind: 'date',
        detail: `evidence dates ${spread} days apart without reconciliation ("${oldest.raw}" vs "${newest.raw}")`,
      });
    }
  }

  const byUnit = new Map<string, Array<{ value: number; raw: string }>>();
  for (const match of content.matchAll(UNIT_VALUE_PATTERN)) {
    const currency = (match[1] ?? match[3] ?? '').toLowerCase().replace(/s$/, '');
    const value = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    const key = `${currency}|${normaliseUnit(match[4])}`;
    const bucket = byUnit.get(key) ?? [];
    bucket.push({ value, raw: match[0].trim() });
    byUnit.set(key, bucket);
  }
  for (const [key, entries] of byUnit) {
    if (entries.length < 2) {
      continue;
    }
    const values = entries.map((entry) => entry.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min > 0 && (max - min) / min > MATERIAL_VALUE_GAP) {
      const low = entries.find((entry) => entry.value === min)!;
      const high = entries.find((entry) => entry.value === max)!;
      conflicts.push({
        kind: 'value',
        detail: `conflicting ${key.replace('|', ' per ')} quotes without reconciliation ("${low.raw}" vs "${high.raw}", ${Math.round(((max - min) / min) * 100)}% apart)`,
      });
    }
  }

  return conflicts;
}
