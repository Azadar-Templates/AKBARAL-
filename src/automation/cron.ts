/**
 * Timezone-safe cron scheduling primitives (Automation milestone).
 *
 * Deliberately dependency-free and minimal: a strict, well-defined subset of
 * standard 5-field cron (minute hour day-of-month month day-of-week).
 * Accepted tokens per field: "*", "*" followed by "/n" (step), or a single
 * number.
 *
 * Ranges, lists and named days are rejected with a clear validation error —
 * every accepted expression has exactly one unambiguous meaning, and matching
 * is minute-granular in the automation's IANA timezone (DST-aware through
 * Intl). Day-of-month/day-of-week follow standard cron OR semantics when both
 * are restricted.
 */

export interface ParsedCronField {
  any: boolean;
  step: number;
  value: number;
}

export interface ParsedCron {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dom: ParsedCronField;
  month: ParsedCronField;
  dow: ParsedCronField;
}

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

export class CronParseError extends Error {}

function parseField(raw: string, index: number): ParsedCronField {
  const [min, max] = FIELD_RANGES[index];
  const label = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'][index];
  if (raw === '*') {
    return { any: true, step: 1, value: -1 };
  }
  const stepMatch = raw.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (step < 1 || step > max) {
      throw new CronParseError(`${label} step must be between 1 and ${max}`);
    }
    return { any: true, step, value: -1 };
  }
  if (!/^\d+$/.test(raw)) {
    throw new CronParseError(
      `${label} field "${raw}" is invalid — supported: *, */n, or a single number`,
    );
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new CronParseError(`${label} must be between ${min} and ${max}`);
  }
  return { any: false, step: 1, value };
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError('cron expression must have exactly 5 fields: minute hour day-of-month month day-of-week');
  }
  return {
    minute: parseField(fields[0], 0),
    hour: parseField(fields[1], 1),
    dom: parseField(fields[2], 2),
    month: parseField(fields[3], 3),
    dow: parseField(fields[4], 4),
  };
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: number; // 0 = Sunday
}

/** Wall-clock parts of an instant inside a timezone (DST-aware). */
export function wallPartsInZone(epochMs: number, tz: string): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const hour = get('hour');
  // en-US with hour12:false can still yield "24" at midnight in some runtimes.
  const normalizedHour = hour === 24 ? 0 : hour;
  const weekday = new Date(epochMs).toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = weekdays.indexOf(weekday.split(',')[0].trim());
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: normalizedHour,
    minute: get('minute'),
    weekday: dow === -1 ? 0 : dow,
  };
}

function offsetMs(epochMs: number, tz: string): number {
  const wall = wallPartsInZone(epochMs, tz);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return wallAsUtc - (epochMs - (epochMs % 60000));
}

/**
 * Epoch for a wall-clock time in a timezone. Returns null when the local
 * time does not exist (spring-forward gap) — matching Vixie cron, such an
 * occurrence is skipped rather than silently shifted. Ambiguous times
 * (fall-back) resolve to the first occurrence.
 */
export function epochForWall(parts: { year: number; month: number; day: number; hour: number; minute: number }, tz: string): number | null {
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    guess = wallAsUtc - offsetMs(guess, tz);
  }
  if (wallMatches(wallPartsInZone(guess, tz), parts)) {
    return guess;
  }
  // Fall-back ambiguity: the alternate candidate may round-trip instead.
  const alternate = wallAsUtc - offsetMs(guess, tz);
  if (wallMatches(wallPartsInZone(alternate, tz), parts)) {
    return Math.min(guess, alternate);
  }
  return null;
}

function wallMatches(
  actual: { year: number; month: number; day: number; hour: number; minute: number },
  expected: { year: number; month: number; day: number; hour: number; minute: number },
): boolean {
  return actual.year === expected.year && actual.month === expected.month && actual.day === expected.day && actual.hour === expected.hour && actual.minute === expected.minute;
}

// ---------------------------------------------------------------------------
// Next-occurrence search
// ---------------------------------------------------------------------------

function fieldMatches(field: ParsedCronField, value: number, base: number): boolean {
  if (field.any) {
    return field.step === 1 || (value - base) % field.step === 0;
  }
  return value === field.value;
}

function dayMatches(cron: ParsedCron, dayAnchorMs: number, domRestricted: boolean, dowRestricted: boolean): boolean {
  const anchor = new Date(dayAnchorMs);
  const dom = anchor.getUTCDate();
  const month = anchor.getUTCMonth() + 1;
  const dow = anchor.getUTCDay();
  if (!fieldMatches(cron.month, month, 1)) {
    return false;
  }
  const domOk = fieldMatches(cron.dom, dom, 1);
  const dowOk = fieldMatches(cron.dow, dow, 0);
  if (domRestricted && dowRestricted) {
    return domOk || dowOk;
  }
  if (domRestricted) {
    return domOk;
  }
  if (dowRestricted) {
    return dowOk;
  }
  return true;
}

const MINUTE_MS = 60_000;
const MAX_SEARCH_DAYS = 400;

/**
 * Next matching instant strictly after `afterEpochMs`, in the cron's
 * timezone. Returns null when no match exists within ~13 months.
 */
export function cronNextAfter(afterEpochMs: number, expression: string, tz: string): number | null {
  const cron = parseCron(expression);
  const start = Math.floor(afterEpochMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const startWall = wallPartsInZone(start, tz);

  // Day anchors are pure wall-calendar math on UTC-anchored dates.
  let dayAnchor = Date.UTC(startWall.year, startWall.month - 1, startWall.day);
  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_DAYS; dayOffset += 1) {
    if (!dayMatches(cron, dayAnchor, !cron.dom.any, !cron.dow.any)) {
      dayAnchor += 86_400_000;
      continue;
    }
    const anchorDate = new Date(dayAnchor);
    const dom = anchorDate.getUTCDate();
    const month = anchorDate.getUTCMonth() + 1;
    const year = anchorDate.getUTCFullYear();
    const firstHour = dayOffset === 0 ? startWall.hour : 0;
    for (let hour = firstHour; hour <= 23; hour += 1) {
      if (!fieldMatches(cron.hour, hour, 0)) {
        continue;
      }
      const firstMinute = dayOffset === 0 && hour === startWall.hour ? startWall.minute : 0;
      for (let minute = firstMinute; minute <= 59; minute += 1) {
        if (!fieldMatches(cron.minute, minute, 0)) {
          continue;
        }
        const candidate = epochForWall({ year, month, day: dom, hour, minute }, tz);
        if (candidate === null) {
          continue; // nonexistent local time (DST gap) — skipped
        }
        if (candidate > afterEpochMs) {
          return candidate;
        }
      }
    }
    dayAnchor += 86_400_000;
  }
  return null;
}
