import { HttpError } from '../server/http';
import { getAgentBySlug, isAgentVisibleToUser } from '../agents/registry';
import { listImplementedTools } from '../tools';
import { cronNextAfter, epochForWall, isValidTimezone, parseCron } from './cron';

/**
 * Automation domain types + strict server-side validation.
 *
 * Every field a client can influence is validated here BEFORE persistence;
 * the persisted JSON is always a normalized, trusted shape.
 */

export const AUTOMATION_LIMITS = {
  maxPerUser: 25,
  maxSteps: 8,
  nameMax: 80,
  descriptionMax: 280,
  goalMax: 2000,
  timeoutMinMs: 5_000,
  timeoutMaxMs: 3_600_000,
  maxRetriesMax: 4,
  intervalMinSeconds: 60,
  intervalMaxSeconds: 2_592_000, // 30 days
  maxConditions: 5,
} as const;

export type AutomationSchedule =
  | { kind: 'once'; runAt: string }
  | { kind: 'cron'; expr: string; tz: string }
  | { kind: 'interval'; seconds: number };

export type AutomationConditionAtom =
  | { type: 'last_run_outcome'; equals: 'completed' | 'failed' }
  | { type: 'min_interval_since_last_run'; seconds: number };

export interface AutomationCondition {
  all?: AutomationConditionAtom[];
  any?: AutomationConditionAtom[];
}

export interface AutomationStep {
  agentSlug: string;
  goal: string;
  toolKey: string | null;
}

export interface AutomationDefinition {
  name: string;
  description: string | null;
  schedule: AutomationSchedule;
  condition: AutomationCondition | null;
  steps: AutomationStep[];
  timeoutMs: number;
  maxRetries: number;
}

const KNOWN_CONDITION_TYPES = new Set(['last_run_outcome', 'min_interval_since_last_run']);

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an object`, 'validation_error');
  }
  return value as Record<string, unknown>;
}

function boundedInt(value: unknown, label: string, min: number, max: number, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${label} is required`, 'validation_error');
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${label} must be an integer between ${min} and ${max}`, 'validation_error');
  }
  return parsed;
}

function cleanString(value: unknown, label: string, max: number, required: boolean): string {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${label} is required`, 'validation_error');
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string`, 'validation_error');
  const trimmed = value.trim();
  if (required && trimmed.length === 0) throw new HttpError(400, `${label} is required`, 'validation_error');
  if (trimmed.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`, 'validation_error');
  return trimmed;
}

/**
 * Parse + validate a schedule. The timezone is applied to naive local
 * timestamps ("2026-09-12T09:00") and verified to exist (spring-forward gap
 * times are rejected honestly instead of being silently shifted).
 */
export function parseScheduleInput(input: Record<string, unknown>): AutomationSchedule {
  const rawKind = input.kind;
  if (rawKind === 'once') {
    const runAtRaw = input.run_at ?? input.runAt;
    if (typeof runAtRaw !== 'string' || runAtRaw.trim().length === 0) {
      throw new HttpError(400, 'run_at is required for a one-time schedule', 'validation_error');
    }
    const tz = validateTimezone(input.tz);
    const epoch = parseRunAt(runAtRaw.trim(), tz);
    const min = Date.now() - 5 * 60_000; // tolerate small clock skew, not the past
    const max = Date.now() + 365 * 24 * 3600 * 1000;
    if (epoch < min) {
      throw new HttpError(400, 'run_at must be in the future', 'validation_error');
    }
    if (epoch > max) {
      throw new HttpError(400, 'run_at must be within the next 365 days', 'validation_error');
    }
    return { kind: 'once', runAt: new Date(epoch).toISOString() };
  }
  if (rawKind === 'cron') {
    const expr = cleanString(input.expr ?? input.expression, 'expr', 100, true);
    try {
      parseCron(expr);
    } catch (error) {
      throw new HttpError(400, `invalid cron expression: ${error instanceof Error ? error.message : 'unknown error'}`, 'validation_error');
    }
    if (cronNextAfter(Date.now(), expr, validateTimezone(input.tz)) === null) {
      throw new HttpError(400, 'cron expression never matches within the next 13 months', 'validation_error');
    }
    return { kind: 'cron', expr, tz: validateTimezone(input.tz) };
  }
  if (rawKind === 'interval') {
    const seconds = boundedInt(input.seconds ?? input.interval_seconds, 'seconds', AUTOMATION_LIMITS.intervalMinSeconds, AUTOMATION_LIMITS.intervalMaxSeconds);
    return { kind: 'interval', seconds };
  }
  throw new HttpError(400, 'schedule.kind must be one of: once, cron, interval', 'validation_error');
}

function validateTimezone(raw: unknown): string {
  const tz = cleanString(raw ?? 'UTC', 'tz', 64, false) || 'UTC';
  if (!isValidTimezone(tz)) {
    throw new HttpError(400, `unknown timezone "${tz}"`, 'validation_error');
  }
  return tz;
}

function parseRunAt(raw: string, tz: string): number {
  const withDesignator = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  if (withDesignator) {
    const epoch = Date.parse(raw);
    if (Number.isNaN(epoch)) {
      throw new HttpError(400, 'run_at is not a valid ISO 8601 timestamp', 'validation_error');
    }
    return epoch;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if (!match) {
    throw new HttpError(400, 'run_at must be ISO 8601 (with a timezone designator, or local time combined with tz)', 'validation_error');
  }
  const epoch = epochForWall(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) },
    tz,
  );
  if (epoch === null) {
    throw new HttpError(400, 'that local time does not exist in the given timezone (daylight-saving gap)', 'validation_error');
  }
  return epoch;
}

export function parseConditionInput(raw: unknown): AutomationCondition | null {
  if (raw === undefined || raw === null) return null;
  const condition = requireObject(raw, 'condition');
  const result: AutomationCondition = {};
  let atoms = 0;
  for (const mode of ['all', 'any'] as const) {
    const list = condition[mode];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) throw new HttpError(400, `condition.${mode} must be an array`, 'validation_error');
    if (list.length === 0) continue;
    const parsed: AutomationConditionAtom[] = [];
    for (const item of list) {
      atoms += 1;
      if (atoms > AUTOMATION_LIMITS.maxConditions) {
        throw new HttpError(400, `at most ${AUTOMATION_LIMITS.maxConditions} condition atoms are allowed`, 'validation_error');
      }
      const atom = requireObject(item, 'condition atom');
      const type = cleanString(atom.type, 'condition.type', 40, true);
      if (!KNOWN_CONDITION_TYPES.has(type)) {
        throw new HttpError(400, `unknown condition type "${type}"`, 'validation_error');
      }
      if (type === 'last_run_outcome') {
        const equals = cleanString(atom.equals, 'condition.equals', 20, true);
        if (equals !== 'completed' && equals !== 'failed') {
          throw new HttpError(400, 'condition.equals must be "completed" or "failed"', 'validation_error');
        }
        parsed.push({ type, equals });
      } else {
        parsed.push({ type: 'min_interval_since_last_run', seconds: boundedInt(atom.seconds, 'condition.seconds', 60, 2_592_000) });
      }
    }
    if (parsed.length > 0) result[mode] = parsed;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function parseStepsInput(raw: unknown, userId: string): AutomationStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, 'steps must be a non-empty array', 'validation_error');
  }
  if (raw.length > AUTOMATION_LIMITS.maxSteps) {
    throw new HttpError(400, `at most ${AUTOMATION_LIMITS.maxSteps} steps are allowed per automation`, 'validation_error');
  }
  const implementedTools = new Set(listImplementedTools());
  const steps: AutomationStep[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const step = requireObject(item, 'step');
    const agentSlug = cleanString(step.agent_slug ?? step.agentSlug, 'steps[].agent_slug', 120, true);
    const goal = cleanString(step.goal, 'steps[].goal', AUTOMATION_LIMITS.goalMax, true);
    const agent = getAgentBySlug(agentSlug);
    if (!agent || !isAgentVisibleToUser(agent, userId)) {
      throw new HttpError(400, `agent "${agentSlug}" does not exist or is not available to you`, 'validation_error');
    }
    let toolKey: string | null = null;
    const rawTool = step.tool_key ?? step.toolKey;
    if (rawTool !== undefined && rawTool !== null && rawTool !== '') {
      toolKey = cleanString(rawTool, 'steps[].tool_key', 80, true);
      if (!implementedTools.has(toolKey)) {
        throw new HttpError(400, `tool "${toolKey}" is not implemented`, 'validation_error');
      }
    }
    const dedupeKey = `${agentSlug}::${goal}`;
    if (seen.has(dedupeKey)) {
      throw new HttpError(400, 'duplicate step (same agent and goal) — every step must be distinct', 'validation_error');
    }
    seen.add(dedupeKey);
    steps.push({ agentSlug, goal, toolKey });
  }
  return steps;
}

/** Full input validation for create/edit. Throws HttpError(400) on any issue. */
export function parseAutomationInput(body: Record<string, unknown>, userId: string): AutomationDefinition {
  const name = cleanString(body.name, 'name', AUTOMATION_LIMITS.nameMax, true);
  const description = cleanString(body.description, 'description', AUTOMATION_LIMITS.descriptionMax, false);
  const scheduleInput = requireObject(body.schedule ?? {}, 'schedule');
  const schedule = parseScheduleInput(scheduleInput);
  const condition = parseConditionInput(body.condition);
  const steps = parseStepsInput(body.steps, userId);
  const timeoutMs = boundedInt(body.timeout_ms ?? body.timeoutMs, 'timeout_ms', AUTOMATION_LIMITS.timeoutMinMs, AUTOMATION_LIMITS.timeoutMaxMs, 900_000);
  const maxRetries = boundedInt(body.max_retries ?? body.maxRetries, 'max_retries', 0, AUTOMATION_LIMITS.maxRetriesMax, 1);
  return {
    name,
    description: description || null,
    schedule,
    condition,
    steps,
    timeoutMs,
    maxRetries,
  };
}

/**
 * First occurrence for a freshly validated schedule (epoch ms), used to seed
 * next_run_at. For intervals the anchor is "now".
 */
export function firstOccurrence(schedule: AutomationSchedule, nowEpochMs: number): number | null {
  if (schedule.kind === 'once') {
    return Date.parse(schedule.runAt);
  }
  if (schedule.kind === 'cron') {
    return cronNextAfter(nowEpochMs, schedule.expr, schedule.tz);
  }
  return nowEpochMs + schedule.seconds * 1000;
}
