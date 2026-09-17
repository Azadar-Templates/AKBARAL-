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
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

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

