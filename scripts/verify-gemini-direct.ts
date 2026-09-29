/**
 * REAL Gemini direct-provider verification (PHASE 1 of the final build).
 *
 * Runs ONLY where outbound egress to Google exists (GitHub Actions runner,
 * production host) — NOT in the Arena sandbox (egress blocked). Verifies the
 * production provider path in this exact commit's CODE:
 *
 *   - real request → real response (text, model, usage accounting)
 *   - real streaming (SSE token events)
 *   - credential-failure classification (deliberately invalid key →
 *     ProviderCallError with an HTTP status; never a hang, never a fake OK)
 *   - unconfigured classification (ProviderNotConfiguredError)
 *   - NO secret material is ever printed (the key travels in headers only)
 *
 * Timeout/retry/429/5xx/MAX_TOKENS/RECITATION handling is classification
 * logic verified by the unit suite (src/models/provider-hardening.test.ts);
 * this script exercises the REAL network path.
 *
 * Usage: GOOGLE_API_KEY=<real key> npx tsx scripts/verify-gemini-direct.ts
 */
import { GoogleProvider, ProviderCallError, ProviderNotConfiguredError, type ChatMessage } from '../src/models/client';
import { MODEL_SPECS } from '../src/models/catalog';
import { geminiModelsSupportingGeneration, selectGeminiCandidates } from '../src/launch/checks';
import type { ModelSpec } from '../src/models/catalog';

const FAILURES: string[] = [];
function ok(condition: boolean, label: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    FAILURES.push(label);
    // Emit a GitHub annotation too: CI job logs are not always retrievable,
    // and a bare "exit code 1" hides WHICH provider check failed. Annotations
    // survive where logs do not. Labels never contain credential material.
    console.log(`::error title=gemini-direct::${label.replace(/\r?\n/g, ' ')}`);
  }
}

async function main(): Promise<void> {
  const key = process.env.GOOGLE_API_KEY ?? '';
  console.log('real Gemini DIRECT provider verification (code path of this commit)');
  if (!key) {
    console.error('GOOGLE_API_KEY is not set in this environment — nothing to verify.');
    process.exit(2);
  }

  const googleModels = MODEL_SPECS.filter((spec) => spec.providerKey === 'google' && spec.capability === 'llm');
  if (googleModels.length === 0) {
    console.error('no google model specs found in the catalog');
    process.exit(2);
  }

  // ── 0. Discover what Google is CURRENTLY serving (ListModels) ───────────
  // A model that is temporarily unavailable (HTTP 503) must not fail this
  // verification when another CURRENT, catalog-supported Gemini model works.
  // Candidates always come from Google's own ListModels response intersected
  // with this build's catalog — no invented model IDs, ever.
  const baseUrl = (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  let offered: string[] = [];
  try {
    const listed = await fetch(`${baseUrl}/models`, { headers: { 'x-goog-api-key': key } });
    if (listed.ok) {
      offered = geminiModelsSupportingGeneration((await listed.json()) as Record<string, unknown>);
    }
    ok(listed.ok, `ListModels reachable and accepted the credential (HTTP ${listed.status})`);
  } catch (error) {
    ok(false, `ListModels failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const candidateKeys = selectGeminiCandidates(
    process.env.AKBARAL_VERIFY_GEMINI_MODEL ?? '',
    offered,
    googleModels.map((spec) => spec.key),
  );
  console.log(`candidates (current & supported): ${candidateKeys.join(', ') || '(none)'}`);

  const provider = new GoogleProvider();
  const messages: ChatMessage[] = [{ role: 'user', content: 'Reply with exactly: AKBARAL-DIRECT-VERIFY-OK' }];

  // ── 1. Real request → real response ─────────────────────────────────────
  // Each candidate already retries transient 429/5xx internally with bounded
  // exponential backoff; only after a candidate is exhausted do we move to
  // the next one. If every candidate fails, the script fails honestly.
  let model: ModelSpec | undefined;
  const attemptErrors: string[] = [];
  for (const candidateKey of candidateKeys) {
    const candidate = googleModels.find((spec) => spec.key === candidateKey) ?? {
      ...googleModels[0],
      key: candidateKey,
      name: candidateKey,
    };
    try {
      const started = Date.now();
      const result = await provider.chat(candidate, messages);
      const elapsed = Date.now() - started;
      model = candidate;
      ok(result.provider === 'google' && result.model === candidate.key, `real response from ${result.model} (${elapsed}ms)`);
      ok(typeof result.text === 'string' && result.text.length > 0, `real non-empty text (${result.text.length} chars)`);
      ok(
        typeof result.inputTokens === 'number' && typeof result.outputTokens === 'number',
        `usage accounting present (in ${result.inputTokens} / out ${result.outputTokens} tokens)`,
      );
      ok(elapsed >= 200, `realistic network latency (${elapsed}ms ≥ 200ms)`);
      break;
    } catch (error) {
      attemptErrors.push(`${candidate.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!model) {
    ok(false, `real request failed on every current candidate — ${attemptErrors.join('; ')}`);
    console.log('');
    console.error(`REAL GEMINI DIRECT: FAILED (${FAILURES.length} check(s))`);
    process.exit(1);
  }

  // ── 2. Real streaming (SSE) ─────────────────────────────────────────────
  try {
    const tokens: string[] = [];
    const streamed = await provider.streamChat(model, messages, (token) => tokens.push(token));
    ok(tokens.length >= 1, `streaming delivered ${tokens.length} token event(s)`);
    ok(typeof streamed.text === 'string' && streamed.text.length > 0, 'streamed final text assembled');
  } catch (error) {
    ok(false, `streaming failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── 3. Credential-failure classification (invalid key → classified HTTP error) ──
  const realKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = 'akbaral-deliberately-invalid-key-for-classification-test';
  try {
    await provider.chat(model, messages);
    ok(false, 'invalid key must NOT succeed');
  } catch (error) {
    if (error instanceof ProviderCallError) {
      ok([400, 401, 403].includes(error.status ?? 0), `credential failure classified (status ${error.status}, code ${error.code})`);
    } else {
      ok(false, `credential failure produced ${error?.constructor?.name ?? 'unknown'} instead of ProviderCallError`);
    }
  } finally {
    process.env.GOOGLE_API_KEY = realKey;
  }

  // ── 4. Unconfigured classification ──────────────────────────────────────
  delete process.env.GOOGLE_API_KEY;
  try {
    await provider.chat(model, messages);
    ok(false, 'missing key must NOT succeed');
  } catch (error) {
    ok(error instanceof ProviderNotConfiguredError && error.code === 'provider_not_configured', 'missing key → provider_not_configured (honest, no network call)');
  } finally {
    process.env.GOOGLE_API_KEY = realKey;
  }

  console.log('');
  if (FAILURES.length > 0) {
    console.error(`REAL GEMINI DIRECT: FAILED (${FAILURES.length} check(s))`);
    process.exit(1);
  }
  console.log('REAL GEMINI DIRECT: ALL CHECKS PASSED (real Google responses, no fixture involved)');
}

void main();
