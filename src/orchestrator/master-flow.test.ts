import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, createUser, getCreditAccount, getWorkflow } from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { analyzeGoal } from './goal-analyzer';
import { createExecutionPlan } from './planner';
import { runWorkflow } from './workflow-runner';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';

/**
 * MASTER AI full-pipeline integration test.
 *
 * Proves the complete USER GOAL -> ANALYSIS -> PLAN -> TOOLS -> EXECUTION ->
 * VERIFICATION -> FINAL RESULT pipeline with the trust policy intact:
 *
 *  1. Red path (no model provider configured): every stage degrades
 *     honestly, agent steps fail with provider_not_configured, free credits
 *     are fully refunded, and the final result says exactly what happened.
 *  2. Green path (local OpenAI-compatible fixture): analysis is LLM-driven,
 *     steps complete, verification passes, credits are consumed once, and a
 *     synthesized final result is persisted.
 *  3. Verification path (thin model output): the verification stage rejects
 *     the output and the credit is refunded.
 */

const suffix = randomBytes(6).toString('hex');
const email = `master-${suffix}@akbaral.test`;

const PROVIDER_ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'AKBARAL_SEARCH_ENDPOINT'];
const savedEnv = new Map<string, string | undefined>();

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
}

function configureFixtureProvider(baseUrl: string): void {
  process.env.OPENAI_API_KEY = 'test-fixture-key';
  process.env.OPENAI_BASE_URL = baseUrl;
}

function restoreProviderEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

let fixture: ModelFixtureServer;
let userId = '';

describe('MASTER AI full pipeline', () => {
  before(async () => {
    clearProviderEnv();
    // Point the search tool at a dead local endpoint so the tool stage fails
    // fast and deterministically (private host -> instant refusal, no network
    // dependency) instead of depending on sandbox egress policy.
    process.env.AKBARAL_SEARCH_ENDPOINT = 'http://127.0.0.1:9/search';
    syncAgentRegistry();
    const user = createUser({ email, name: 'Master Flow Test' });
    userId = user.id;
    fixture = await startModelFixture('ok');
  });

  after(async () => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
    restoreProviderEnv();
    if (fixture) {
      await fixture.close();
    }
  });

  it('red path: no provider -> honest analysis, honest failure, full refund', async () => {
    // Stage 1: goal analysis falls back to heuristic honestly.
    const analysis = await analyzeGoal({ goal: 'build a marketing website for my bakery' });
    assert.equal(analysis.mode, 'heuristic');
    assert.ok(analysis.intents.some((intent) => intent.key === 'website'));

    // Stage 2: plan persists a workflow with real specialist agents.
    const planned = createExecutionPlan({ userId, goal: 'build a marketing website for my bakery', analysis });
    assert.ok(planned.plan.steps.length >= 2);
    assert.ok(planned.plan.steps.every((step) => step.agentSlug.length > 0));
    const stored = getWorkflow(planned.workflowId);
    assert.ok(stored?.plan_json ? String(stored.plan_json).includes('analysis') : false, 'plan_json persisted');

    // Stages 3-6: run fails honestly; credit refunded.
    const run = await runWorkflow(planned.workflowId);
    assert.equal(run.status, 'failed');
    assert.ok(run.error?.includes('not configured'));

    const finalResult = run.result.finalResult as Record<string, unknown>;
    assert.equal(finalResult.mode, 'deterministic');
    assert.equal(finalResult.status, 'completed_with_failures');
    const credits = finalResult.credits as { consumed: number; refunded: number };
    assert.equal(credits.consumed, 1);
    assert.equal(credits.refunded, 1);
    assert.ok((finalResult.executiveSummary as string).includes('1 step(s) failed'));

    // Trust policy: the free task credit was restored.
    assert.equal(getCreditAccount(userId)?.free_credits, 5);
  });

  it('green path: fixture provider -> full pipeline completes with verification', async () => {
    configureFixtureProvider(fixture.baseUrl);

    // Stage 1: LLM analysis, validated against the registry (1 invented
    // intent must be dropped by validation).
    const analysis = await analyzeGoal({ goal: 'build a marketing website for my bakery' });
    assert.equal(analysis.mode, 'llm');
    assert.equal(analysis.intents.length, 1);
    assert.equal(analysis.intents[0].categorySlug, 'web-development');
    assert.ok(analysis.notes.some((note) => note.includes('1 model-proposed intent(s) dropped')));

    // Stage 2: plan.
    const planned = createExecutionPlan({ userId, goal: 'build a marketing website for my bakery', analysis });
    assert.equal(planned.plan.steps.length, 3);

    // Stages 3-6.
    const run = await runWorkflow(planned.workflowId);
    assert.equal(run.status, 'completed');
    assert.equal(run.completedSteps, 3);

    const finalResult = run.result.finalResult as {
      mode: string;
      status: string;
      executiveSummary: string;
      sections: Array<{ agentSlug: string; verified: boolean; status: string }>;
      credits: { consumed: number; refunded: number };
    };
    assert.equal(finalResult.mode, 'llm');
    assert.equal(finalResult.status, 'completed');
    assert.equal(finalResult.sections.length, 3);
    assert.ok(finalResult.sections.every((section) => section.verified && section.status === 'completed'));
    assert.ok(finalResult.sections.every((section) => section.agentSlug.startsWith('web-development-')));
    assert.ok(finalResult.executiveSummary.length > 20);
    assert.deepEqual(finalResult.credits, { consumed: 3, refunded: 0 });

    // Trust policy: exactly 3 credits consumed (one per specialist step).
    assert.equal(getCreditAccount(userId)?.free_credits, 2);

    // The persisted workflow result contains the final result document.
    const stored = getWorkflow(planned.workflowId);
    const storedResult = stored?.result_json ? (JSON.parse(String(stored.result_json)) as { finalResult?: unknown }) : null;
    assert.ok(storedResult?.finalResult);

    clearProviderEnv();
  });

  it('verification path: thin model output is rejected and the credit refunded', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('thin_output');

    const planned = createExecutionPlan({ userId, goal: 'build a marketing website for my bakery' });
    const run = await runWorkflow(planned.workflowId);
    assert.equal(run.status, 'failed');
    assert.ok(run.error?.startsWith('verification_failed'), `expected verification_failed, got: ${run.error}`);

    const finalResult = run.result.finalResult as { credits: { consumed: number; refunded: number } };
    assert.deepEqual(finalResult.credits, { consumed: 1, refunded: 1 });
    assert.equal(getCreditAccount(userId)?.free_credits, 2, 'credit restored after verification failure');

    fixture.setMode('ok');
    clearProviderEnv();
  });

  it('verification path: fabricated citations are rejected for source-verifying agents', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('fabricate');
    const balanceBefore = getCreditAccount(userId)?.free_credits ?? 0;

    // Research agents declare source verification, so invented citations
    // must fail the contract even though the text is long and structured.
    const planned = createExecutionPlan({ userId, goal: 'research the competitor landscape for bakeries' });
    const run = await runWorkflow(planned.workflowId);
    assert.equal(run.status, 'failed');
    assert.ok(run.error?.includes('no_fabricated_sources'), `expected fabrication failure, got: ${run.error}`);
    assert.equal(getCreditAccount(userId)?.free_credits, balanceBefore, 'credit restored');

    fixture.setMode('ok');
    clearProviderEnv();
  });
});
