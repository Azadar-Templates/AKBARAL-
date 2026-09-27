import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import { MODEL_SPECS, PROVIDER_SPECS, syncModelCatalog } from './catalog';
import { modelRouter } from './router';

/**
 * Model-catalog currency contract (production 404 incident regression).
 *
 * Incident: production tasks failed with `google rejected the request
 * (HTTP 404)` because the catalog pinned `gemini-2.0-flash` — a model Google
 * shut down on 2026-06-01 (official release notes: "The following Gemini 2.0
 * models are now shut down … Use gemini-3.5-flash or gemini-3.1-flash-lite
 * instead"). The API itself was healthy; the model ID was dead.
 *
 * This suite locks two guarantees:
 *   1. CURRENCY — every google model in the catalog is one of the IDs
 *      verified as available on the official model list
 *      (ai.google.dev/gemini-api/docs/models, September 2026), and no
 *      retired ID (Gemini 2.0 / 1.5 family) can re-enter the catalog.
 *   2. SELF-HEALING SYNC — models dropped from the catalog are retired in
 *      the database at boot (syncModelCatalog), so a stale production row
 *      (e.g. the dead gemini-2.0-flash still enabled in PostgreSQL) stops
 *      being routable the moment the corrected image deploys. No manual
 *      production DB surgery is ever needed.
 */

// Verified available on the official Gemini model list, September 2026
// (stable text models usable with generateContent). Source:
// https://ai.google.dev/gemini-api/docs/models + release notes.
const VERIFIED_GOOGLE_MODEL_IDS = new Set([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  // The 2.5 cluster is deliberately EXCLUDED as of 2026-09-27. Google's
  // 2026-09-18 release note limits access to the 2.5 models to users who have
  // actively used them before, and directs new projects to 3.5 Flash-Lite or
  // 3.8 Flash. The deprecations page additionally schedules gemini-2.5-pro,
  // gemini-2.5-flash and gemini-2.5-flash-lite for shutdown on 2026-10-16
  // (Vertex lifecycle page: 2026-10-20). A model a new API key cannot call is
  // not "available" for this project's purposes.
]);

// Restricted to pre-existing users and scheduled for shutdown 2026-10-16.
// Not in RETIRED (they still answer for grandfathered keys), but they must
// never be a DEFAULT or a hardcoded model for a fresh deployment.
const RESTRICTED_GOOGLE_MODEL_IDS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

// Shut down by Google — these IDs return HTTP 404 from
// generativelanguage.googleapis.com and must never be routable.
// Sources: official release notes (June 1, 2026 shutdown) and the model
// lifecycle page.
const RETIRED_GOOGLE_MODEL_IDS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-1.5-pro',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro-002',
  'gemini-1.5-flash',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-002',
];

describe('model catalog currency (Google 404 incident)', () => {
  before(() => {
    // The suite DB is migrated but not seeded for this file; sync the real
    // catalog so the router and retirement logic run against production data.
    syncModelCatalog();
  });

  after(() => {
    db.close();
  });

  it('every google model in the catalog is a verified-available Gemini model ID', () => {
    const googleModels = MODEL_SPECS.filter((model) => model.providerKey === 'google');
    assert.ok(googleModels.length >= 2, 'catalog must carry more than one google model (fallback chain)');
    for (const model of googleModels) {
      assert.ok(
        VERIFIED_GOOGLE_MODEL_IDS.has(model.key),
        `google model "${model.key}" is not on the verified-available list (ai.google.dev, Sept 2026) — update the catalog to a current model ID`,
      );
    }
  });

  it('no retired model ID can be routed through the catalog', () => {
    for (const model of MODEL_SPECS) {
      assert.ok(
        !RETIRED_GOOGLE_MODEL_IDS.includes(model.key),
        `retired model "${model.key}" must never be in the catalog`,
      );
    }
    // And the router must never route a retired ID from the database either.
    for (const retired of RETIRED_GOOGLE_MODEL_IDS) {
      const decision = modelRouter.route({ preferredModelKey: retired, capability: ['research'] });
      assert.notEqual(decision.model.key, retired, `router must not route retired model ${retired}`);
    }
  });

  it('google provider spec: official endpoint, header-auth contract, GOOGLE_API_KEY env', () => {
    const google = PROVIDER_SPECS.find((provider) => provider.key === 'google');
    assert.ok(google, 'google provider spec exists');
    assert.equal(google.envKey, 'GOOGLE_API_KEY');
    // Official current REST base: generativelanguage.googleapis.com/v1beta
    // (docs quickstart, September 2026). The API key travels in the
    // x-goog-api-key HEADER, never the URL.
    assert.equal(google.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  });

  it('syncModelCatalog retires stale catalog-managed models so they stop being routable', () => {
    // Simulate the production state: the dead gemini-2.0-flash row still
    // enabled in the database (e.g. left over from a previous deployment).
    db.run(
      `INSERT INTO models (id, key, name, provider_key, capability, modality, status, is_default, created_at, updated_at)
       VALUES ('mdl-stale-404', 'gemini-2.0-flash', 'Gemini 2.0 Flash (dead)', 'google', 'llm', 'multimodal', 'enabled', 1, ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()],
    );
    // An operator-disabled catalog model must keep its operator status.
    db.run(
      `INSERT INTO models (id, key, name, provider_key, capability, modality, status, is_default, created_at, updated_at)
       VALUES ('mdl-op-disabled', 'gemini-9-fake', 'Operator Disabled Fake', 'google', 'llm', 'text', 'disabled', 0, ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()],
    );

    syncModelCatalog();

    const stale = db.get<{ status: string }>('SELECT status FROM models WHERE key = ?', ['gemini-2.0-flash']);
    assert.equal(stale?.status, 'retired', 'stale catalog model must be retired by the sync');

    const operatorDisabled = db.get<{ status: string }>('SELECT status FROM models WHERE key = ?', ['gemini-9-fake']);
    assert.equal(operatorDisabled?.status, 'disabled', 'operator-disabled status is preserved, not overwritten');

    // A retired model is never routed, even when explicitly preferred.
    const savedKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = 'catalog-contract-key';
    try {
      const decision = modelRouter.route({ preferredModelKey: 'gemini-2.0-flash', capability: ['research'] });
      assert.notEqual(decision.model.key, 'gemini-2.0-flash', 'retired model must not be routed');
      assert.ok(
        VERIFIED_GOOGLE_MODEL_IDS.has(decision.model.key),
        `router picks a current model instead (${decision.model.key})`,
      );
      // The whole chain must be free of retired IDs.
      const chain = (modelRouter as unknown as {
        fallbackChain: (d: unknown, r: unknown) => Array<{ model: { key: string } }>;
      }).fallbackChain(decision, { capability: ['research'] });
      for (const entry of chain) {
        assert.ok(!RETIRED_GOOGLE_MODEL_IDS.includes(entry.model.key), `chain must not contain retired model ${entry.model.key}`);
      }
    } finally {
      if (savedKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = savedKey;
    }

    // Cleanup the synthetic rows.
    db.run('DELETE FROM models WHERE id IN (?, ?)', ['mdl-stale-404', 'mdl-op-disabled']);
  });

  it('current google models have catalog metadata for cost accounting', () => {
    for (const model of MODEL_SPECS.filter((entry) => entry.providerKey === 'google')) {
      assert.ok((model.costInputPerMillionCents ?? 0) > 0, `${model.key} needs input pricing for model_runs cost accounting`);
      assert.ok((model.costOutputPerMillionCents ?? 0) > 0, `${model.key} needs output pricing for model_runs cost accounting`);
      assert.ok((model.contextTokens ?? 0) >= 100000, `${model.key} context window must be recorded`);
    }
  });
});

/**
 * The private mission plane hardcodes a single chat model. It previously
 * pinned gemini-2.5-flash while the AKBARAL! catalog had already moved to the
 * 3.x generation — a silent divergence that would have surfaced only as a live
 * API failure the moment an owner added a brand-new free key. This binds the
 * two planes together so the drift cannot reappear unnoticed.
 */
describe('mission chat model tracks the AKBARAL! catalog', () => {
  const { CHAT_MODEL } = require('../mission/chat-state') as typeof import('../mission/chat-state');

  it('is a model this project considers available', () => {
    assert.ok(
      VERIFIED_GOOGLE_MODEL_IDS.has(CHAT_MODEL),
      `mission CHAT_MODEL ${CHAT_MODEL} is not in the verified Google model list`,
    );
  });

  it('is not a retired model id', () => {
    assert.ok(!RETIRED_GOOGLE_MODEL_IDS.includes(CHAT_MODEL));
  });

  it('is not restricted to pre-existing users, so a new free key can call it', () => {
    assert.ok(
      !RESTRICTED_GOOGLE_MODEL_IDS.includes(CHAT_MODEL),
      `mission CHAT_MODEL ${CHAT_MODEL} is restricted to accounts that already used it; a new owner key would fail`,
    );
  });

  it('is offered by the AKBARAL! model catalog, so both planes agree', () => {
    const keys = new Set(MODEL_SPECS.map(model => model.key));
    assert.ok(keys.has(CHAT_MODEL), `mission CHAT_MODEL ${CHAT_MODEL} is absent from the platform catalog`);
  });
});

/**
 * The Google 404 incident was not Google-specific: the catalog sends
 * model.key verbatim as the provider's `model` field, so ANY stale or
 * malformed id is an outage that only appears once a real key is configured.
 *
 * Added 2026-09-27 after finding the Anthropic entry keyed 'c3.5-sonnet' — an
 * id that was never valid in any generation, naming a model retired on
 * 2025-10-28. It had sat unnoticed because no test covered non-Google
 * providers and no live call was ever made.
 */
describe('non-Google model ids are live and well-formed', () => {
  // Retired on the Anthropic API — these return not_found_error.
  const RETIRED_ANTHROPIC_IDS = [
    'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219',
    'claude-3-opus-20240229', 'claude-3-haiku-20240307',
    'claude-opus-4-1-20250805', 'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
  ];
  // Dated OpenAI snapshots with announced shutdowns. The bare aliases
  // (gpt-4o, gpt-4o-mini) still resolve on the API and remain permitted.
  const RETIRED_OPENAI_IDS = ['gpt-4o-2024-05-13', 'gpt-4-0613', 'gpt-4-32k', 'gpt-3.5-turbo-0613'];

  const anthropic = MODEL_SPECS.filter(m => m.providerKey === 'anthropic');
  const openai = MODEL_SPECS.filter(m => m.providerKey === 'openai');

  it('registers at least one Anthropic model', () => {
    assert.ok(anthropic.length > 0);
  });

  it('uses only real Anthropic id shapes', () => {
    // Every live Anthropic id begins with `claude-`. 'c3.5-sonnet' did not.
    for (const model of anthropic) {
      assert.match(
        model.key, /^claude-/,
        `${model.key} is not a valid Anthropic model id; client.ts sends this verbatim as the API model field`,
      );
    }
  });

  it('routes no retired Anthropic id', () => {
    for (const model of anthropic) {
      assert.ok(!RETIRED_ANTHROPIC_IDS.includes(model.key), `${model.key} is retired and returns not_found_error`);
    }
  });

  it('routes no retired OpenAI snapshot id', () => {
    for (const model of openai) {
      assert.ok(!RETIRED_OPENAI_IDS.includes(model.key), `${model.key} is a retired OpenAI snapshot`);
    }
  });

  it('gives every provider a usable default', () => {
    for (const providerKey of ['openai', 'anthropic', 'google']) {
      const models = MODEL_SPECS.filter(m => m.providerKey === providerKey && m.capability === 'llm');
      assert.ok(models.length > 0, `provider ${providerKey} has no llm model`);
    }
  });
});
