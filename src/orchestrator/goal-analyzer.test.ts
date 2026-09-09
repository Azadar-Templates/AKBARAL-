import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGoal, analyzeGoalHeuristic, extractJsonObject } from './goal-analyzer';
import type { CompletionFn } from './goal-analyzer';

describe('goal analyzer (heuristic mode)', () => {
  it('detects website intents deterministically', () => {
    const analysis = analyzeGoalHeuristic('Build a landing page website for my bakery');
    assert.equal(analysis.mode, 'heuristic');
    assert.ok(analysis.intents.some((intent) => intent.key === 'website'));
    assert.ok(analysis.intents.every((intent) => intent.roleKeys.length > 0));
    assert.ok(analysis.deliverables.includes('website'));
  });

  it('falls back to a general research intent when nothing matches', () => {
    const analysis = analyzeGoalHeuristic('xyzzy quux blorb');
    assert.equal(analysis.intents.length, 1);
    assert.equal(analysis.intents[0].key, 'general');
    assert.ok(analysis.clarifiers.length >= 1, 'should ask for clarification');
  });

  it('classifies complexity by scope', () => {
    assert.equal(analyzeGoalHeuristic('write a poem').complexity, 'simple');
    const complex = analyzeGoalHeuristic(
      'research the market, build a website, write the copy, plan the launch, handle the seo and create a brand identity for my company',
    );
    assert.equal(complex.complexity, 'complex');
  });

  it('never claims llm mode', () => {
    const analysis = analyzeGoalHeuristic('research competitors');
    assert.equal(analysis.mode, 'heuristic');
    assert.ok(analysis.notes.some((note) => note.includes('deterministic')));
  });
});

describe('goal analyzer (llm mode)', () => {
  const validJson = JSON.stringify({
    intents: [
      { key: 'site', label: 'Website build', categorySlug: 'web-development', roleKeys: ['strategist', 'builder'], confidence: 0.9 },
    ],
    deliverables: ['website'],
    constraints: ['responsive'],
    complexity: 'standard',
    clarifyingQuestions: [],
  });

  it('uses llm mode when the provider returns valid registry-validated JSON', async () => {
    const fake: CompletionFn = async () => ({ text: validJson, model: 'test-model', provider: 'test' });
    const analysis = await analyzeGoal({ goal: 'make me a website', complete: fake });
    assert.equal(analysis.mode, 'llm');
    assert.equal(analysis.intents[0].categorySlug, 'web-development');
    assert.ok(analysis.notes.some((note) => note.includes('test/test-model')));
  });

  it('drops model-proposed intents that fail registry validation', async () => {
    const fake: CompletionFn = async () => ({
      text: JSON.stringify({
        intents: [
          { key: 'ok', label: 'Research', categorySlug: 'research', roleKeys: ['researcher'], confidence: 0.8 },
          { key: 'bad-cat', label: 'Fake', categorySlug: 'does-not-exist', roleKeys: ['researcher'], confidence: 0.9 },
          { key: 'bad-role', label: 'Bad roles', categorySlug: 'research', roleKeys: ['wizard'], confidence: 0.9 },
        ],
        deliverables: [],
        constraints: [],
        complexity: 'simple',
        clarifyingQuestions: [],
      }),
      model: 'test-model',
      provider: 'test',
    });
    const analysis = await analyzeGoal({ goal: 'research something', complete: fake });
    assert.equal(analysis.mode, 'llm');
    assert.equal(analysis.intents.length, 1);
    assert.equal(analysis.intents[0].key, 'ok');
    assert.ok(analysis.notes.some((note) => note.includes('2 model-proposed intent(s) dropped')));
  });

  it('falls back to heuristic honestly when the provider is not configured', async () => {
    const fake: CompletionFn = async () => {
      throw new Error('openai is not configured; set OPENAI_API_KEY');
    };
    const analysis = await analyzeGoal({ goal: 'build a website', complete: fake });
    assert.equal(analysis.mode, 'heuristic');
    assert.ok(analysis.notes.some((note) => note.includes('Model analysis unavailable')));
    assert.ok(analysis.intents.some((intent) => intent.key === 'website'));
  });

  it('falls back to heuristic when the model returns unparseable output', async () => {
    const fake: CompletionFn = async () => ({ text: 'sounds like a website project!', model: 'm', provider: 'p' });
    const analysis = await analyzeGoal({ goal: 'build a website', complete: fake });
    assert.equal(analysis.mode, 'heuristic');
    assert.ok(analysis.notes.some((note) => note.includes('unparseable')));
  });

  it('falls back when the model invents every category (validation empty)', async () => {
    const fake: CompletionFn = async () => ({
      text: JSON.stringify({ intents: [{ key: 'x', label: 'X', categorySlug: 'nope', roleKeys: ['nope'] }] }),
      model: 'm',
      provider: 'p',
    });
    const analysis = await analyzeGoal({ goal: 'research competitors', complete: fake });
    assert.equal(analysis.mode, 'heuristic');
    assert.ok(analysis.notes.some((note) => note.includes('registry validation')));
  });
});

describe('extractJsonObject', () => {
  it('extracts a balanced object from surrounding prose', () => {
    const text = 'Here you go: {"a": {"b": 1}, "c": "x}y"} hope that helps';
    assert.equal(extractJsonObject(text), '{"a": {"b": 1}, "c": "x}y"}');
  });

  it('returns null when no object exists', () => {
    assert.equal(extractJsonObject('no json here'), null);
  });
});
