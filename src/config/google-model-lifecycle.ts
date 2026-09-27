// ─────────────────────────────────────────────────────────────────────────────
// Google Gemini model lifecycle
//
// Model ids, free-tier eligibility, retirement dates and the correct thinking
// parameter, taken from Google's own model pages (ai.google.dev/gemini-api/docs
// /models, firebase.google.com/docs/ai-logic/models and the Gemini Enterprise
// model-versions page), read on 2026-09-27.
//
// Two facts here are load-bearing and were both getting silently wrong answers:
//
//   1. gemini-2.5-flash retires on 2026-10-20. A deployment pinned to it stops
//      answering on that date with HTTP 404, which looks exactly like a bad key.
//   2. Gemini 3.x REJECTS generationConfig.thinkingConfig.thinkingBudget with
//      HTTP 400 INVALID_ARGUMENT; it takes thinkingLevel instead, and the two
//      may never be sent together. A request body written for 2.5 therefore
//      fails 100% of the time against a 3.x model.
//
// google-model-lifecycle.test.ts fails the build if a default model is retired,
// is inside the warning window, or is not free-tier.
// ─────────────────────────────────────────────────────────────────────────────

export type ThinkingControl =
  /** Gemini 2.x: generationConfig.thinkingConfig.thinkingBudget (integer). */
  | 'budget'
  /** Gemini 3.x: generationConfig.thinkingConfig.thinkingLevel (enum). */
  | 'level';

export interface GoogleModel {
  id: string;
  /** Callable on the API free tier without a billing account. */
  freeTier: boolean;
  /**
   * Google's published retirement date (ISO), or null when none is announced.
   * "No earlier than" dates are recorded as the earliest possible date.
   */
  retiresOn: string | null;
  thinking: ThinkingControl;
  /** Lowest thinking level the model accepts, for latency-sensitive chat. */
  lowestThinkingLevel: 'minimal' | 'low';
  note: string;
}

export const GOOGLE_MODELS: GoogleModel[] = [
  {
    id: 'gemini-3.8-flash',
    freeTier: true,
    retiresOn: null,
    thinking: 'level',
    lowestThinkingLevel: 'low',
    note: 'Current top Flash (released 2026-09-02). Free tier is the most rate-limited of the free models.',
  },
  {
    id: 'gemini-3.5-flash',
    freeTier: true,
    retiresOn: '2027-05-19',
    thinking: 'level',
    lowestThinkingLevel: 'low',
    note: 'Stable Flash with a published one-year floor.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    freeTier: true,
    retiresOn: '2027-07-21',
    thinking: 'level',
    lowestThinkingLevel: 'minimal',
    note: 'Newest Flash-Lite: highest free daily allowance of the current generation.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    freeTier: true,
    retiresOn: '2027-05-07',
    thinking: 'level',
    lowestThinkingLevel: 'minimal',
    note: 'Cheapest current-generation model, 1M context, GA. Default for high-volume agent chat.',
  },
  {
    id: 'gemini-2.5-flash',
    freeTier: true,
    retiresOn: '2026-10-20',
    thinking: 'budget',
    lowestThinkingLevel: 'minimal',
    note: 'RETIRING: Google replaces it with gemini-3.5-flash-lite or gemini-3.1-flash-lite.',
  },
  {
    id: 'gemini-2.0-flash',
    freeTier: false,
    retiresOn: '2026-06-01',
    thinking: 'budget',
    lowestThinkingLevel: 'minimal',
    note: 'Already shut down; requests return HTTP 404. Present only so a regression is named, never selected.',
  },
];

/** Days before a retirement date at which we start refusing to call it a default. */
export const RETIREMENT_WARNING_DAYS = 90;

export function googleModel(id: string): GoogleModel | undefined {
  return GOOGLE_MODELS.find((model) => model.id === id);
}

export type LifecycleStatus = 'ok' | 'retiring soon' | 'retired' | 'unknown';

export interface Lifecycle {
  status: LifecycleStatus;
  daysRemaining: number | null;
  retiresOn: string | null;
  replacement: string | null;
  message: string;
}

/**
 * Lifecycle verdict for a model id. `today` is injectable so the check is
 * deterministic in tests instead of drifting with the clock.
 */
function daysUntilRetirement(model: GoogleModel, today: Date): number | null {
  if (!model.retiresOn) return null;
  return Math.floor((Date.parse(`${model.retiresOn}T00:00:00Z`) - today.getTime()) / 86_400_000);
}

export function modelLifecycle(id: string, today: Date = new Date()): Lifecycle {
  const model = googleModel(id);
  if (!model) {
    return {
      status: 'unknown',
      daysRemaining: null,
      retiresOn: null,
      replacement: null,
      message: `${id} is not in the verified Google model list; its lifecycle and free-tier status are unknown.`,
    };
  }
  if (!model.retiresOn) {
    return { status: 'ok', daysRemaining: null, retiresOn: null, replacement: null, message: `${id} has no announced retirement date.` };
  }
  const remaining = daysUntilRetirement(model, today) ?? 0;
  const replacement = remaining > RETIREMENT_WARNING_DAYS ? null : recommendedFreeModel(today);
  if (remaining <= 0) {
    return {
      status: 'retired',
      daysRemaining: remaining,
      retiresOn: model.retiresOn,
      replacement,
      message: `${id} was retired on ${model.retiresOn} and now returns HTTP 404. Switch to ${replacement}.`,
    };
  }
  if (remaining <= RETIREMENT_WARNING_DAYS) {
    return {
      status: 'retiring soon',
      daysRemaining: remaining,
      retiresOn: model.retiresOn,
      replacement,
      message: `${id} is retired by Google on ${model.retiresOn} (${remaining} days): replies stop with HTTP 404 on that date. Switch to ${replacement}.`,
    };
  }
  return {
    status: 'ok',
    daysRemaining: remaining,
    retiresOn: model.retiresOn,
    replacement: null,
    message: `${id} is supported until at least ${model.retiresOn}.`,
  };
}

/**
 * The free-tier model with the longest remaining life, preferring Flash-Lite:
 * it carries the highest free daily request allowance, which is what a fleet of
 * agent conversations actually runs out of.
 */
export function recommendedFreeModel(today: Date = new Date()): string {
  const usable = GOOGLE_MODELS.filter((model) => {
    if (!model.freeTier) return false;
    const remaining = daysUntilRetirement(model, today);
    return remaining === null || remaining > RETIREMENT_WARNING_DAYS;
  });
  const lite = usable.filter((model) => model.id.includes('flash-lite'));
  const pool = lite.length > 0 ? lite : usable;
  return pool.sort((a, b) => (b.retiresOn ?? '9999').localeCompare(a.retiresOn ?? '9999'))[0]?.id ?? 'gemini-3.1-flash-lite';
}

/**
 * The generationConfig.thinkingConfig body for a model. Sending the wrong shape
 * is a hard 400 from the API, so this is derived from the model id and never
 * hardcoded at a call site.
 */
export function thinkingConfigFor(id: string): Record<string, unknown> {
  const model = googleModel(id);
  if (model?.thinking === 'budget') return { thinkingBudget: 0 };
  return { thinkingLevel: model?.lowestThinkingLevel ?? 'minimal' };
}
