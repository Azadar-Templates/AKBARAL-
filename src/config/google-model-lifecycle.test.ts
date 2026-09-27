import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_MODELS,
  RETIREMENT_WARNING_DAYS,
  googleModel,
  modelLifecycle,
  recommendedFreeModel,
  thinkingConfigFor,
} from './google-model-lifecycle';
import { MODEL_SPECS } from '../models/catalog';
import { CHAT_MODEL } from '../mission/chat-state';

/**
 * These tests exist because both failure modes below were real: a chat pinned
 * to a model Google retires in three weeks, and a request body that the newer
 * models reject outright. Neither is visible until the day it breaks in
 * production, so they are gated here instead.
 */

it('every model the AKBARAL! catalog can route to is a known Google model that is still alive', () => {
  const catalogGoogleModels = MODEL_SPECS.filter((spec) => spec.providerKey === 'google');
  assert.ok(catalogGoogleModels.length > 0, 'the catalog registers at least one Google model');
  for (const spec of catalogGoogleModels) {
    const known = googleModel(spec.key);
    assert.ok(known, `${spec.key} is routable but absent from the verified Google model table`);
    const lifecycle = modelLifecycle(spec.key);
    assert.notEqual(lifecycle.status, 'retired', `${spec.key} is retired and returns HTTP 404: ${lifecycle.message}`);
  }
});

it('the mission chat model is free tier, not retiring, and never a shut-down id', () => {
  const model = googleModel(CHAT_MODEL);
  assert.ok(model, `the bound chat model ${CHAT_MODEL} must be in the verified table`);
  assert.equal(model.freeTier, true, 'a mission chat binding may only use a free-tier model');
  const lifecycle = modelLifecycle(CHAT_MODEL);
  assert.equal(lifecycle.status, 'ok', lifecycle.message);
  assert.ok(
    lifecycle.daysRemaining === null || lifecycle.daysRemaining > RETIREMENT_WARNING_DAYS,
    `the bound model has only ${lifecycle.daysRemaining} days of announced life left`,
  );
});

it('names the retirement of gemini-2.5-flash instead of discovering it as a 404', () => {
  const lifecycle = modelLifecycle('gemini-2.5-flash', new Date('2026-09-27T00:00:00Z'));
  assert.equal(lifecycle.status, 'retiring soon');
  assert.equal(lifecycle.retiresOn, '2026-10-20');
  assert.equal(lifecycle.daysRemaining, 23);
  assert.ok(lifecycle.replacement, 'a retiring model must name its replacement');
  assert.match(lifecycle.message, /HTTP 404/);
});

it('reports an already shut-down model as retired, with a replacement', () => {
  const lifecycle = modelLifecycle('gemini-2.0-flash', new Date('2026-09-27T00:00:00Z'));
  assert.equal(lifecycle.status, 'retired');
  assert.ok(lifecycle.daysRemaining !== null && lifecycle.daysRemaining < 0);
  assert.equal(lifecycle.replacement, recommendedFreeModel(new Date('2026-09-27T00:00:00Z')));
});

it('does not pretend to know the lifecycle of an unlisted model', () => {
  const lifecycle = modelLifecycle('gemini-9-imaginary');
  assert.equal(lifecycle.status, 'unknown');
  assert.match(lifecycle.message, /unknown/);
});

it('sends thinkingBudget to Gemini 2.x and thinkingLevel to Gemini 3.x, never both', () => {
  // Gemini 3.x answers thinkingBudget with 400 INVALID_ARGUMENT; 2.x does not
  // understand thinkingLevel. Sending both is a documented 400.
  assert.deepEqual(thinkingConfigFor('gemini-2.5-flash'), { thinkingBudget: 0 });
  for (const model of GOOGLE_MODELS.filter((entry) => entry.thinking === 'level')) {
    const config = thinkingConfigFor(model.id);
    assert.equal('thinkingBudget' in config, false, `${model.id} must not receive thinkingBudget`);
    assert.ok(['minimal', 'low'].includes(String(config.thinkingLevel)));
  }
  // An unknown model gets the modern shape rather than the retired one.
  assert.deepEqual(thinkingConfigFor('gemini-9-imaginary'), { thinkingLevel: 'minimal' });
});

it('recommends a free-tier Flash-Lite with the longest remaining life', () => {
  const today = new Date('2026-09-27T00:00:00Z');
  const recommended = recommendedFreeModel(today);
  const model = googleModel(recommended);
  assert.ok(model);
  assert.equal(model.freeTier, true);
  assert.equal(modelLifecycle(recommended, today).status, 'ok');
});

it('every listed model states a thinking control and a free-tier verdict', () => {
  for (const model of GOOGLE_MODELS) {
    assert.ok(['budget', 'level'].includes(model.thinking), `${model.id} declares a thinking control`);
    assert.equal(typeof model.freeTier, 'boolean');
    assert.ok(model.note.length > 10, `${model.id} explains itself`);
    if (model.retiresOn) assert.match(model.retiresOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});
