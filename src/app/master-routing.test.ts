import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGoalHeuristic } from '../orchestrator/goal-analyzer';

/**
 * Build #4 §1 — MASTER must route each headline goal to the correct real
 * specialist category, including in the deterministic (no-provider) fallback
 * analyzer. These are the exact phrasings from the MASTER workspace contract.
 */

const CASES: Array<[string, string, string]> = [
  ['Build me a website', 'web-development', 'website'],
  ['Create an image of a mountain lake at sunrise', 'image-generation', 'image'],
  ['Create a document summarizing our Q4 goals', 'documents', 'document'],
  ['Research this market carefully', 'research', 'research'],
  ['Compare these products for my team', 'e-commerce', 'shopping'],
  ['Plan my business for the next year', 'business-strategy', 'business-plan'],
  ['Find cheap flights to Dubai', 'travel', 'travel'],
  ['Analyze this dataset of monthly sales', 'data-analysis', 'data'],
  ['Find good coffee shops near me', 'maps-local-business', 'maps'],
];

describe('MASTER goal routing (deterministic analyzer, Build #4 §1)', () => {
  for (const [goal, expectedCategory, expectedKey] of CASES) {
    it(`"${goal}" routes to ${expectedCategory}`, () => {
      const analysis = analyzeGoalHeuristic(goal);
      assert.ok(analysis.intents.length >= 1, 'at least one intent');
      const match = analysis.intents.find((intent) => intent.categorySlug === expectedCategory);
      assert.ok(match, `expected a ${expectedCategory} intent, got: ${analysis.intents.map((i) => i.categorySlug).join(', ')}`);
      assert.equal(match.key, expectedKey);
    });
  }

  it('unknown goals still fall back to the honest general/research intent', () => {
    const analysis = analyzeGoalHeuristic('Translate this paragraph to French');
    assert.ok(analysis.intents.length >= 1);
    assert.equal(analysis.mode, 'heuristic', 'mode is disclosed');
  });
});
