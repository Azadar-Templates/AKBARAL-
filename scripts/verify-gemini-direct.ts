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
import type { ModelSpec } from '../src/models/catalog';

const FAILURES: string[] = [];
function ok(condition: boolean, label: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) FAILURES.push(label);
}

async function main(): Promise<void> {
  const key = process.env.GOOGLE_API_KEY ?? '';
  console.log('real Gemini DIRECT provider verification (code path of this commit)');
  if (!key) {
    console.error('GOOGLE_API_KEY is not set in this environment — nothing to verify.');
    process.exit(2);
  }

  const googleModels = MODEL_SPECS.filter((spec) => spec.providerKey === 'google' && spec.capability === 'llm');
  const model: ModelSpec | undefined = googleModels.find((spec) => spec.key === 'gemini-3.8-flash') ?? googleModels[0];
  if (!model) {
    console.error('no google model specs found in the catalog');
    process.exit(2);
  }
  const provider = new GoogleProvider();
  const messages: ChatMessage[] = [{ role: 'user', content: 'Reply with exactly: AKBARAL-DIRECT-VERIFY-OK' }];

  // ── 1. Real request → real response ─────────────────────────────────────
  try {
    const started = Date.now();
    const result = await provider.chat(model, messages);
    const elapsed = Date.now() - started;
    ok(result.provider === 'google' && result.model === model.key, `real response from ${result.model} (${elapsed}ms)`);
    ok(typeof result.text === 'string' && result.text.length > 0, `real non-empty text (${result.text.length} chars)`);
    ok(
      typeof result.inputTokens === 'number' && typeof result.outputTokens === 'number',
      `usage accounting present (in ${result.inputTokens} / out ${result.outputTokens} tokens)`,
    );
    ok(elapsed >= 200, `realistic network latency (${elapsed}ms ≥ 200ms)`);
  } catch (error) {
    ok(false, `real request failed: ${error instanceof Error ? error.message : String(error)}`);
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
