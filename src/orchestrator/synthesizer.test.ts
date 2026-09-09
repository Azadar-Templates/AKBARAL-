import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeFinalResult } from './synthesizer';
import type { CompletionFn } from './goal-analyzer';

const steps = [
  {
    stepOrder: 0,
    agentSlug: 'web-development-strategist-001',
    specialization: 'Strategic Architect',
    status: 'completed' as const,
    verified: true,
    verificationScore: 1,
    content: '## Strategy\nA complete website strategy with phases.',
  },
  {
    stepOrder: 1,
    agentSlug: 'web-development-builder-002',
    specialization: 'Implementation Builder',
    status: 'completed' as const,
    verified: true,
    verificationScore: 0.83,
    content: '## Implementation\nThe build plan with a component breakdown.',
  },
  {
    stepOrder: 2,
    agentSlug: 'research-researcher-003',
    specialization: 'Research Analyst',
    status: 'failed' as const,
    verified: false,
    verificationScore: 0,
    content: '',
    error: 'provider_not_configured: openai requires credential environment variable OPENAI_API_KEY',
  },
];

describe('synthesizer (deterministic mode)', () => {
  it('assembles an honest final result document', async () => {
    const document = await synthesizeFinalResult({
      goal: 'Build a marketing website',
      steps,
      credits: { consumed: 3, refunded: 1 },
    });
    assert.equal(document.mode, 'deterministic');
    assert.equal(document.status, 'completed_with_failures');
    assert.equal(document.sections.length, 3);
    assert.equal(document.sections[0].agentSlug, 'web-development-strategist-001');
    assert.ok(document.sections[0].verified);
    assert.equal(document.sections[2].status, 'failed');
    assert.ok(document.executiveSummary.includes('2 specialist step(s) completed'));
    assert.ok(document.executiveSummary.includes('1 step(s) failed'));
    assert.ok(document.nextSteps.some((step) => step.includes('Retry the failed step')));
    assert.deepEqual(document.credits, { consumed: 3, refunded: 1 });
  });

  it('reports completed status when nothing failed', async () => {
    const document = await synthesizeFinalResult({
      goal: 'Research topic',
      steps: steps.slice(0, 2),
      credits: { consumed: 2, refunded: 0 },
    });
    assert.equal(document.status, 'completed');
    assert.ok(document.executiveSummary.includes('2 specialist step(s) completed'));
  });
});

describe('synthesizer (llm mode)', () => {
  it('uses the model summary when the provider is available', async () => {
    const fake: CompletionFn = async () => ({
      text: JSON.stringify({
        executiveSummary: 'The specialist team produced a verified strategy and build plan.',
        nextSteps: ['Approve the strategy', 'Start the build'],
      }),
      model: 'synth-model',
      provider: 'test',
    });
    const document = await synthesizeFinalResult({
      goal: 'Build a marketing website',
      steps: steps.slice(0, 2),
      credits: { consumed: 2, refunded: 0 },
      complete: fake,
    });
    assert.equal(document.mode, 'llm');
    assert.equal(document.executiveSummary, 'The specialist team produced a verified strategy and build plan.');
    assert.deepEqual(document.nextSteps, ['Approve the strategy', 'Start the build']);
  });

  it('keeps the deterministic document when the provider fails', async () => {
    const broken: CompletionFn = async () => {
      throw new Error('openai is not configured; set OPENAI_API_KEY');
    };
    const document = await synthesizeFinalResult({
      goal: 'Build a marketing website',
      steps: steps.slice(0, 2),
      credits: { consumed: 2, refunded: 0 },
      complete: broken,
    });
    assert.equal(document.mode, 'deterministic');
    assert.ok(document.executiveSummary.length > 0);
  });

  it('never calls the provider when no step completed', async () => {
    let called = 0;
    const fake: CompletionFn = async () => {
      called += 1;
      return { text: '{}', model: 'm', provider: 'p' };
    };
    const document = await synthesizeFinalResult({
      goal: 'Doomed goal',
      steps: [steps[2]],
      credits: { consumed: 1, refunded: 1 },
      complete: fake,
    });
    assert.equal(called, 0);
    assert.equal(document.mode, 'deterministic');
    assert.equal(document.status, 'completed_with_failures');
  });
});
