import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAgentOutput } from './verifier';
import {
  assessFreshness,
  assessSourceEvidence,
  detectConflicts,
  detectCurrencyIntent,
  extractDates,
  MAX_EVIDENCE_AGE_DAYS,
  userRequestText,
} from './research-evidence';
import type { AgentView } from '../agents/registry';

/**
 * Regression suite for the live gold-price defect.
 *
 * Observed in production: "Research the current price of gold in Pakistan
 * today ..." returned 2024 figures, quoted two conflicting dates (October 24,
 * 2024 and May 22, 2024) as if both were current, and named sources without a
 * single verifiable URL — and verification passed it.
 *
 * These tests lock in the fix WITHOUT weakening anything: the honest outcome
 * for unobtainable current data is a FAILED verification, never a pass.
 */

function researchAgent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'agt_research',
    name: 'Research Analyst',
    slug: 'research-researcher-001',
    ownerId: null,
    specialization: 'Research Analyst',
    description: 'Discovers, compares and cites credible information.',
    category: 'Research',
    categorySlug: 'research',
    version: '1.0.0',
    status: 'active',
    systemInstructions: 'You research carefully.',
    capabilities: ['research', 'reasoning'],
    inputs: ['question'],
    outputs: ['research report', 'source table'],
    modelRequirements: ['research'],
    toolPermissions: ['web_search', 'page_fetch'],
    apiRequirements: [],
    workflow: ['search sources', 'grade credibility'],
    verificationRules: ['source verification', 'citation completeness', 'no fabrication'],
    securityPermissions: ['no fabricated citations'],
    costUsage: { estimatedTokens: 3000, estimatedCents: 3, priority: 'medium' },
    fallbackStrategy: 'retry with cheaper model',
    evaluationConfig: { metrics: ['accuracy'], rubric: 'Accurate, cited, complete', testCases: [] },
    tools: [],
    ...overrides,
  };
}

const GOAL = 'Research the current price of gold in Pakistan today and give the source, date/time, and calculation in USD.';
const NOW = new Date('2026-09-29T10:00:00Z');

/** The real tool context shape: verbatim web_search output with real URLs. */
const TOOL_CONTEXT = `--- VERIFIED TOOL CONTEXT (real data retrieved by the platform; cite only these sources) ---
--- TOOL web_search (real result) ---
[
  { "title": "Gold rate today", "url": "https://www.forex.pk/gold-rates.php", "snippet": "Gold 24K per tola PKR 402,500 on 2026-09-29" },
  { "title": "Live gold price", "url": "https://www.hamariweb.com/finance/gold_rates.aspx", "snippet": "24K tola PKR 402,900 (29 September 2026)" }
]`;

function check(result: Awaited<ReturnType<typeof verifyAgentOutput>>, name: string) {
  const found = result.checks.find((entry) => entry.name === name);
  assert.ok(found, `expected a ${name} check to run`);
  return found;
}

describe('research freshness — the reported production defect', () => {
  it('FAILS a "current/today" request answered with stale 2024 data', async () => {
    const stale = `## Gold price in Pakistan (current)

The current price of gold in Pakistan is PKR 245,000 per tola.

### Details
- As of October 24, 2024 the 24K rate was PKR 245,000 per tola.
- Converted at the prevailing rate this is about USD 880 per tola.

### Sources
- Karachi Sarafa Bazaar
- Pakistan Bullion Market Association`;

    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: stale,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });

    assert.equal(result.passed, false, 'stale data must never pass a current-data request');
    const freshness = check(result, 'evidence_freshness');
    assert.equal(freshness.passed, false);
    assert.equal(freshness.severity, 'hard');
    assert.match(freshness.detail, /October 24, 2024/);
    assert.match(freshness.detail, /day\(s\) old/);
    assert.ok(
      result.issues.some((issue) => issue.startsWith('evidence_freshness:')),
      'the failure reason is recorded for the server-side audit trail',
    );
  });

  it('FAILS materially conflicting source dates/values presented as one current answer', async () => {
    const conflicting = `## Gold price in Pakistan (today)

- On October 24, 2024 the rate was PKR 245,000 per tola.
- On May 22, 2024 the rate was PKR 238,000 per tola.

Both figures are reported below as the current price.

Source: https://www.forex.pk/gold-rates.php`;

    const conflicts = detectConflicts(conflicting);
    assert.ok(conflicts.some((conflict) => conflict.kind === 'date'), 'the 5-month date gap is a material conflict');

    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: conflicting,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(result.passed, false);
    const conflict = check(result, 'source_conflict');
    assert.equal(conflict.passed, false);
    assert.equal(conflict.severity, 'hard');
    assert.match(conflict.detail, /October 24, 2024|May 22, 2024/);
  });

  it('ALLOWS a conflict that the answer itself reports honestly', async () => {
    const reported = `## Gold price in Pakistan — 2026-09-29

Sources disagree by a small margin today; both values are shown.

- PKR 402,500 per tola — https://www.forex.pk/gold-rates.php (2026-09-29)
- PKR 402,900 per tola — https://www.hamariweb.com/finance/gold_rates.aspx (2026-09-29)

The discrepancy is 0.1% and is reported rather than averaged.`;

    assert.deepEqual(detectConflicts(reported), [], 'a conflict the answer discloses is not a verification failure');
    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: reported,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(check(result, 'source_conflict').passed, true);
  });

  it('FAILS externally sourced claims that carry no verifiable source URL', async () => {
    const unsourced = `## Gold price in Pakistan — 2026-09-29

The 24K rate today is PKR 402,500 per tola, which is about USD 1,430.

### Sources
- Karachi Sarafa Bazaar
- According to Pakistan Bullion Market Association`;

    const evidence = assessSourceEvidence(unsourced, TOOL_CONTEXT);
    assert.equal(evidence.urls.length, 0);
    assert.equal(evidence.namedWithoutUrl, true, 'named sources without URLs are detected');

    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: unsourced,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(result.passed, false);
    const source = check(result, 'source_evidence');
    assert.equal(source.passed, false);
    assert.equal(source.severity, 'hard');
    assert.match(source.detail, /no verifiable URL|without a single verifiable source URL/);
  });

  it('FAILS citations that appear nowhere in the context the platform actually retrieved', async () => {
    const fabricated = `## Gold price in Pakistan — 2026-09-29

24K gold is PKR 402,500 per tola today.

Source: https://totally-made-up-bullion-index.example/live (2026-09-29)`;

    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: fabricated,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(result.passed, false);
    assert.match(check(result, 'source_evidence').detail, /cited URL\(s\) appear in the context/);
  });

  it('PASSES genuinely current, URL-backed, non-conflicting evidence', async () => {
    const good = `## Gold price in Pakistan — 2026-09-29 (retrieved today)

### Current rate
24K gold is PKR 402,500 per tola as of 2026-09-29, 09:40 PKT.

### Source
- https://www.forex.pk/gold-rates.php — published 2026-09-29 09:40 PKT

### Calculation in USD
PKR 402,500 / 278.5 PKR per USD = USD 1,445 per tola (rate from the same page, 2026-09-29).`;

    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: good,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(result.passed, true, result.issues.join(' | '));
    assert.equal(check(result, 'evidence_freshness').passed, true);
    assert.equal(check(result, 'source_evidence').passed, true);
    assert.equal(check(result, 'source_conflict').passed, true);
  });

  it('FAILS a current-data request whose answer carries no date at all', async () => {
    const undated = `## Gold price in Pakistan

24K gold is PKR 402,500 per tola.

Source: https://www.forex.pk/gold-rates.php`;
    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: undated,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(result.passed, false);
    assert.match(check(result, 'evidence_freshness').detail, /no source date or timestamp/);
  });

  it('accepts an honest "current data unavailable" answer instead of substituted history', async () => {
    // Requirement 5: when live data cannot be obtained the answer must say so.
    // Such an answer states no stale date and invents no figure, so the
    // freshness and conflict gates do not fire on it.
    const honest = `## Current gold price in Pakistan — not available right now

I could not retrieve a current (2026-09-29) gold rate for Pakistan from the
sources available to this run.

### What was attempted
- https://www.forex.pk/gold-rates.php returned no dated quote for today.

### What I will not do
I will not substitute an older rate, because a historical figure is not the
current price you asked for.`;
    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: GOAL,
      content: honest,
      sourceContextUsed: true,
      sourceContext: TOOL_CONTEXT,
      now: NOW,
    });
    assert.equal(check(result, 'evidence_freshness').passed, true, 'today\'s date is present and current');
    assert.equal(check(result, 'source_conflict').passed, true);
  });

  it('does not gate a non-research agent that merely uses the word "current"', async () => {
    // "the current time" in a coding task is not an externally sourced claim.
    const coder = researchAgent({
      slug: 'development-backend-001',
      specialization: 'Backend Engineer',
      category: 'Development',
      categorySlug: 'development',
      capabilities: ['coding'],
      verificationRules: ['compiles', 'handles errors'],
      securityPermissions: ['no destructive commands'],
      toolPermissions: [],
      outputs: ['code', 'explanation'],
    });
    const answer = `## Implementation

\`\`\`ts
export function nowIso(): string {
  return new Date().toISOString();
}
\`\`\`

### Notes
This returns the current time in ISO-8601 form and has no external dependency.
It is pure apart from the clock read, so tests inject a fixed clock instead.`;
    const result = await verifyAgentOutput({
      agent: coder,
      goal: 'Write a TypeScript helper that returns the current time as an ISO string',
      content: answer,
      now: NOW,
    });
    assert.equal(check(result, 'evidence_freshness').passed, true);
    assert.match(check(result, 'evidence_freshness').detail, /not applicable/);
    assert.equal(check(result, 'source_evidence').passed, true);
    assert.equal(result.passed, true, result.issues.join(' | '));
  });

  it('leaves non-current research untouched (no new gate fires)', async () => {
    const historical = `## Gold price in Pakistan during 2024

### Findings
- On October 24, 2024 the 24K rate was PKR 245,000 per tola.
- On May 22, 2024 the 24K rate was PKR 238,000 per tola.

### Evidence summary
Both figures come from the retrieved source table and are labelled with their dates.`;
    const result = await verifyAgentOutput({
      agent: researchAgent(),
      goal: 'Research how the gold price in Pakistan moved during 2024',
      content: historical,
      now: NOW,
    });
    assert.equal(check(result, 'evidence_freshness').passed, true);
    assert.equal(check(result, 'evidence_freshness').detail, 'Request does not ask for current data; freshness check not applicable.');
    assert.equal(check(result, 'source_evidence').passed, true);
    assert.equal(check(result, 'source_conflict').severity, 'soft', 'historical research is not gated on conflicts');
    assert.equal(result.passed, true);
  });
});

describe('research evidence primitives', () => {
  it('ignores platform-injected context when reading intent (website-editing regression)', () => {
    // The executor appends the current project artifact to the goal. The word
    // "CURRENT" in OUR marker must not turn a website edit into a live-data
    // request (this failed the website-builder flow before the fix).
    const injected =
      'Build a website: Remove the contact section from the website\n\n' +
      '[CURRENT PROJECT ARTIFACT v1 — the existing website HTML. Modify THIS document per the request and return the complete updated HTML document.]\n' +
      '<!doctype html>\n<html lang="en"><head><title>Aurora Coffee</title></head><body><section id="contact">Contact</section></body></html>';
    assert.equal(detectCurrencyIntent(injected), null);
    assert.equal(userRequestText(injected).trim(), 'Build a website: Remove the contact section from the website');
    // A real user request keeps its intent even with context appended.
    assert.equal(detectCurrencyIntent(`${GOAL}\n\n[CURRENT PROJECT ARTIFACT v1]`), 'today');
  });

  it('reads currency intent from the user wording', () => {
    assert.equal(detectCurrencyIntent(GOAL), 'today');
    assert.equal(detectCurrencyIntent('what is the latest USD to PKR rate'), 'current');
    assert.equal(detectCurrencyIntent('live gold price'), 'today');
    assert.equal(detectCurrencyIntent('summarise the history of the gold standard'), null);
    assert.equal(MAX_EVIDENCE_AGE_DAYS.today, 2);
  });

  it('parses the date formats models actually emit — and invents none', () => {
    const dates = extractDates('Seen on October 24, 2024, again on 2026-09-29 and on 22 May 2024.');
    assert.deepEqual(dates.map((entry) => entry.date.toISOString().slice(0, 10)), ['2024-05-22', '2024-10-24', '2026-09-29']);
    assert.deepEqual(extractDates('no dates here at all'), []);
    assert.deepEqual(extractDates('version 2024-99-99 is not a date'), []);
  });

  it('measures staleness against the run clock', () => {
    const stale = assessFreshness(GOAL, 'rate as of October 24, 2024', NOW);
    assert.equal(stale.verdict, 'stale');
    assert.ok((stale.ageDays ?? 0) > 700);
    assert.equal(assessFreshness(GOAL, 'rate as of 2026-09-29', NOW).verdict, 'ok');
    assert.equal(assessFreshness(GOAL, 'rate as of 2027-01-01', NOW).verdict, 'future', 'a future date cannot be real evidence');
    assert.equal(assessFreshness('history of gold', 'October 24, 2024', NOW).verdict, 'ok');
  });

  it('flags materially different quotes for the same unit', () => {
    const conflicts = detectConflicts('PKR 402,500 per tola in one place and PKR 245,000 per tola in another.');
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, 'value');
    assert.match(conflicts[0].detail, /% apart/);
    assert.deepEqual(detectConflicts('PKR 402,500 per tola and PKR 402,900 per tola'), [], '0.1% is not material');
  });

  it('corroborates citations against the retrieved context by host', () => {
    const evidence = assessSourceEvidence(
      'See https://www.forex.pk/gold-rates.php and https://invented.example/x',
      TOOL_CONTEXT,
    );
    assert.deepEqual(evidence.corroborated, ['https://www.forex.pk/gold-rates.php']);
    assert.deepEqual(evidence.uncorroborated, ['https://invented.example/x']);
  });
});
