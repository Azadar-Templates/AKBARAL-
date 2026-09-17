import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAgentOutput } from './verifier';
import type { AgentView } from '../agents/registry';
import type { CompletionFn } from './goal-analyzer';

function agentFixture(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'agt_test',
    name: 'Test Specialist',
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
    inputs: ['question', 'scope'],
    outputs: ['research report', 'source table', 'evidence summary'],
    modelRequirements: ['research', 'reasoning'],
    toolPermissions: ['web_search', 'page_fetch'],
    apiRequirements: [],
    workflow: ['identify question', 'search sources', 'grade credibility'],
    verificationRules: ['source verification', 'citation completeness', 'no fabrication'],
    securityPermissions: ['no fabricated citations'],
    costUsage: { estimatedTokens: 3000, estimatedCents: 3, priority: 'medium' },
    fallbackStrategy: 'retry with cheaper model',
    evaluationConfig: { metrics: ['accuracy'], rubric: 'Accurate, cited, complete', testCases: [] },
    tools: [],
    ...overrides,
  };
}

const substantive = `## Research report

This report analyzes the question with real substance across sections.

### Findings
- Finding one with detail.
- Finding two with detail.

### Evidence summary
The evidence supports the conclusion described below.`;

describe('verifier contract checks', () => {
  it('passes substantive structured output', async () => {
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research the market for electric bikes',
      content: substantive,
    });
    assert.equal(result.passed, true);
    assert.equal(result.mode, 'contract');
    assert.ok(result.score > 0.5);
    assert.ok(result.checks.some((check) => check.name === 'non_empty' && check.passed));
    assert.ok(result.checks.some((check) => check.name === 'substance' && check.passed));
  });

  it('fails empty output', async () => {
    const result = await verifyAgentOutput({ agent: agentFixture(), goal: 'research', content: '   ' });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.startsWith('non_empty')));
  });

  it('fails thin unstructured output', async () => {
    const result = await verifyAgentOutput({ agent: agentFixture(), goal: 'research', content: 'yes.' });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.startsWith('substance')));
  });

  it('fails a bare refusal', async () => {
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research pricing',
      content: 'I cannot help with that request.',
    });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.startsWith('no_refusal')));
  });

  it('fails fabricated citations when no source tool ran', async () => {
    const content = `${substantive}\n\n[Source: https://example.com/invented-stats]`;
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research the market',
      content,
      sourceContextUsed: false,
    });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.startsWith('no_fabricated_sources')));
  });

  it('allows citations when real source context was used', async () => {
    const content = `${substantive}\n\n[Source: https://example.com/real]`;
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research the market',
      content,
      sourceContextUsed: true,
    });
    assert.equal(result.passed, true);
  });

  it('skips the fabrication check for agents that do not declare source verification', async () => {
    const agent = agentFixture({
      verificationRules: ['objective alignment'],
      securityPermissions: ['no sensitive data leakage'],
      capabilities: ['reasoning'],
    });
    const content = `${substantive}\n\nSee https://example.com/page.`;
    const result = await verifyAgentOutput({ agent, goal: 'plan a strategy', content });
    const check = result.checks.find((c) => c.name === 'no_fabricated_sources');
    assert.equal(check?.passed, true);
    assert.ok(check?.detail.includes('not applicable'));
  });

  it('records soft checks without gating on them', async () => {
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'completely unrelated topic about garden furniture',
      content: substantive,
    });
    const goalAddressed = result.checks.find((check) => check.name === 'goal_addressed');
    assert.equal(goalAddressed?.severity, 'soft');
    // Soft check may fail without failing verification.
    if (!goalAddressed?.passed) {
      assert.equal(result.passed, true);
    }
  });
});

describe('verifier llm rubric check', () => {
  it('applies the llm verdict when the provider grades the output', async () => {
    const failRubric: CompletionFn = async () => ({
      text: JSON.stringify({ verdict: 'fail', issues: ['missing source table'] }),
      model: 'grader',
      provider: 'test',
    });
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research the market',
      content: substantive,
      complete: failRubric,
    });
    assert.equal(result.mode, 'contract+llm');
    assert.equal(result.passed, false);
    assert.equal(result.llm?.verdict, 'fail');
    assert.ok(result.issues.some((issue) => issue.startsWith('llm_rubric')));
  });

  it('passes when the rubric verdict is pass', async () => {
    const passRubric: CompletionFn = async () => ({
      text: JSON.stringify({ verdict: 'pass', issues: [] }),
      model: 'grader',
      provider: 'test',
    });
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research the market',
      content: substantive,
      complete: passRubric,
    });
    assert.equal(result.mode, 'contract+llm');
    assert.equal(result.passed, true);
  });

  it('degrades to contract-only when the rubric provider fails', async () => {
    const broken: CompletionFn = async () => {
      throw new Error('openai is not configured; set OPENAI_API_KEY');
    };
    const result = await verifyAgentOutput({
      agent: agentFixture(),
      goal: 'research the market',
      content: substantive,
      complete: broken,
    });
    assert.equal(result.mode, 'contract');
    assert.equal(result.passed, true);
    assert.ok(result.checks.some((check) => check.name === 'llm_rubric' && check.detail.includes('unavailable')));
  });
});
