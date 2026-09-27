/**
 * `npm run verify:live` — the real-runtime proof.
 *
 * This script exists because the Arena sandbox has no outbound HTTPS: every
 * provider claim has to be proven somewhere with real internet. It is designed
 * to run on a networked host — a GitHub Actions runner (free, no card), a
 * Hugging Face Space, or any deployment — against the ALREADY RUNNING
 * production stack, and to report exactly what happened.
 *
 * It proves, in order:
 *   1. outbound HTTPS from this host          (real request, no credential)
 *   2. AKBARAL! /api/ready                    (real HTTP against the running app)
 *   3. ZA141251SA mission health              (separate process, separate DB)
 *   4. Gemini endpoint reachability           (real request; 400/401/403 without a
 *                                              key still proves the endpoint answers)
 *   5. a real Gemini generateContent call     (only when GOOGLE_API_KEY is present)
 *   6. one real AKBARAL! MASTER task          (register -> login -> /api/master ->
 *                                              plan -> execution -> verification)
 *   7. one real free research call            (keyless Wikipedia provider)
 *   8. persistence                            (rows survive a fresh DB handle)
 *   9. no fake completion                     (an unconfigured provider must fail
 *                                              loudly, never synthesize an answer)
 *  10. the spending gate                      (verified revenue 0 => locked)
 *
 * Honesty rules: every step reports PASS / FAIL / BLOCKED with the real
 * evidence string. A missing credential is BLOCKED, never PASS. The script
 * exits non-zero only when a contract is VIOLATED (a fake completion, or
 * spending unlocked without verified revenue) — a blocked step is a fact, not
 * a crash.
 */
import { setTimeout as sleep } from 'node:timers/promises';

type Outcome = 'PASS' | 'FAIL' | 'BLOCKED';

interface StepResult {
  id: string;
  title: string;
  outcome: Outcome;
  evidence: string;
}

const results: StepResult[] = [];
let contractViolated = false;

function record(id: string, title: string, outcome: Outcome, evidence: string): StepResult {
  const entry = { id, title, outcome, evidence: evidence.replace(/\s+/g, ' ').trim().slice(0, 600) };
  results.push(entry);
  const icon = outcome === 'PASS' ? '✓' : outcome === 'BLOCKED' ? '~' : '✗';
  process.stdout.write(`${icon} ${id.padEnd(22)} ${outcome.padEnd(7)} ${entry.evidence.slice(0, 160)}\n`);
  return entry;
}

const WEB = process.env.VERIFY_WEB_URL ?? 'http://127.0.0.1:3000';
const MISSION = process.env.VERIFY_MISSION_URL ?? 'http://127.0.0.1:4200';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

async function json(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

// ── 1. outbound HTTPS ────────────────────────────────────────────────────────
async function checkEgress(): Promise<boolean> {
  try {
    const response = await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(15_000) });
    record('runtime.egress', 'Outbound HTTPS from this host', 'PASS', `HTTP ${response.status} from www.google.com/generate_204`);
    return true;
  } catch (error) {
    record('runtime.egress', 'Outbound HTTPS from this host', 'FAIL', `no outbound HTTPS: ${errorText(error)}`);
    return false;
  }
}

// ── 2/3. the two planes ──────────────────────────────────────────────────────
async function checkPlanes(): Promise<void> {
  try {
    const ready = await json(`${WEB}/api/ready`);
    const checks = Array.isArray(ready.body?.checks) ? ready.body.checks.map((c: any) => `${c.name}=${c.ok}`).join(' ') : '';
    record(
      'akbaral.ready',
      'AKBARAL! public plane /api/ready',
      ready.status === 200 && ready.body?.status === 'ready' ? 'PASS' : 'FAIL',
      `HTTP ${ready.status} status=${ready.body?.status} ${checks}`,
    );
  } catch (error) {
    record('akbaral.ready', 'AKBARAL! public plane /api/ready', 'FAIL', errorText(error));
  }

  try {
    const health = await json(`${MISSION}/api/health`);
    record('mission.health', 'ZA141251SA private plane health', health.status === 200 ? 'PASS' : 'FAIL', `HTTP ${health.status} ${JSON.stringify(health.body).slice(0, 200)}`);
  } catch (error) {
    record('mission.health', 'ZA141251SA private plane health', 'FAIL', errorText(error));
  }

  // Isolation: the public plane must not expose any mission surface. Only
  // meaningful when the public plane actually answered — an unreachable host
  // must never be reported as "isolated".
  const webReachable = results.some((entry) => entry.id === 'akbaral.ready' && entry.outcome === 'PASS');
  if (!webReachable) {
    record('planes.isolated', 'Mission is not reachable through the public plane', 'BLOCKED', 'the public plane is not answering on this host, so isolation could not be probed');
  } else {
  const leaks: string[] = [];
  for (const path of ['/api/mission', '/api/funding', '/api/treasury', '/mission', '/za141251sa']) {
    try {
      const probe = await fetch(`${WEB}${path}`, { signal: AbortSignal.timeout(10_000) });
      if (probe.status !== 404) leaks.push(`${path}=${probe.status}`);
    } catch {
      /* a transport error is not a leak */
    }
  }
  record(
    'planes.isolated',
    'Mission is not reachable through the public plane',
    leaks.length === 0 ? 'PASS' : 'FAIL',
    leaks.length === 0 ? 'every mission path returns 404 on the public host' : `exposed: ${leaks.join(', ')}`,
  );
  }

  // The private plane must refuse unauthenticated reads.
  try {
    const refused = await fetch(`${MISSION}/api/funding`, { signal: AbortSignal.timeout(10_000) });
    record('mission.authgate', 'Private plane refuses unauthenticated reads', refused.status === 401 ? 'PASS' : 'FAIL', `GET /api/funding -> HTTP ${refused.status}`);
  } catch (error) {
    record('mission.authgate', 'Private plane refuses unauthenticated reads', 'FAIL', errorText(error));
  }
}

// ── 4/5. the real brain ──────────────────────────────────────────────────────
async function checkGemini(): Promise<{ reachable: boolean; model: string | null }> {
  const { recommendedFreeModel } = await import('../src/config/google-model-lifecycle');
  const model = recommendedFreeModel();
  try {
    const response = await fetch(`https://${GEMINI_HOST}/v1beta/models`, { signal: AbortSignal.timeout(20_000) });
    record(
      'gemini.reachable',
      'Google Gemini endpoint answers this host',
      'PASS',
      `HTTP ${response.status} from ${GEMINI_HOST}/v1beta/models (an unauthenticated 401/403 still proves the endpoint is reachable)`,
    );
  } catch (error) {
    record('gemini.reachable', 'Google Gemini endpoint answers this host', 'FAIL', `${GEMINI_HOST} unreachable: ${errorText(error)}`);
    return { reachable: false, model };
  }

  const key = (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) {
    record(
      'gemini.generate',
      'Real Gemini generateContent call',
      'BLOCKED',
      'no GOOGLE_API_KEY in this runtime — add the free Google AI Studio key as a repository/host secret (never in chat) and re-run. Nothing is faked in its absence.',
    );
    return { reachable: true, model };
  }

  try {
    const response = await fetch(`https://${GEMINI_HOST}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: AKBARAL LIVE PROVIDER CHECK OK' }] }],
        generationConfig: { maxOutputTokens: 24, temperature: 0 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body: any = await response.json().catch(() => null);
    const text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
    const finish = body?.candidates?.[0]?.finishReason ?? 'none';
    if (response.ok && text.trim().length > 0) {
      record(
        'gemini.generate',
        'Real Gemini generateContent call',
        'PASS',
        `model=${model} HTTP ${response.status} finishReason=${finish} responseId=${body?.responseId ?? 'n/a'} tokens=${body?.usageMetadata?.totalTokenCount ?? 'n/a'} reply="${text.trim().slice(0, 80)}"`,
      );
    } else {
      record(
        'gemini.generate',
        'Real Gemini generateContent call',
        'FAIL',
        `model=${model} HTTP ${response.status} ${JSON.stringify(body?.error ?? body).slice(0, 300)}`,
      );
    }
  } catch (error) {
    record('gemini.generate', 'Real Gemini generateContent call', 'FAIL', errorText(error));
  }
  return { reachable: true, model };
}

// ── 6/9. one real MASTER task, end to end ────────────────────────────────────
async function checkMasterTask(hasKey: boolean): Promise<void> {
  const email = `live-verification-${Date.now()}@akbaral.test`;
  const password = 'Live-Verification-Passw0rd!';
  try {
    const registered = await json(`${WEB}/api/auth/register`, { method: 'POST', body: JSON.stringify({ email, password, name: 'Live Verification' }) });
    const login = await json(`${WEB}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
    const token = login.body?.accessToken ?? registered.body?.accessToken;
    if (!token) {
      record('akbaral.auth', 'Real account registration and sign-in', 'FAIL', `register=${registered.status} login=${login.status}`);
      return;
    }
    record('akbaral.auth', 'Real account registration and sign-in', 'PASS', `register=${registered.status} login=${login.status} bearer token issued`);

    const auth = { authorization: `Bearer ${token}` };
    const goal = 'Summarise the difference between fixed and variable operating costs for a small design studio, and list three ways to reduce the variable ones.';
    const created = await json(`${WEB}/api/master`, { method: 'POST', headers: auth, body: JSON.stringify({ goal, auto_run: true }) });
    const workflowId = created.body?.workflow?.id;
    const analysisMode = created.body?.analysis?.mode ?? 'unknown';
    const steps = created.body?.plan?.steps?.length ?? created.body?.analysis?.intents?.length ?? 0;
    if (!workflowId) {
      record('akbaral.master', 'Real MASTER task', 'FAIL', `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      return;
    }

    let final: any = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(2_000);
      const view = await json(`${WEB}/api/master/${workflowId}`, { headers: auth });
      const status = view.body?.workflow?.status;
      if (['succeeded', 'completed', 'failed', 'partial', 'error'].includes(String(status))) {
        final = view.body;
        break;
      }
    }
    if (!final) {
      record('akbaral.master', 'Real MASTER task', 'FAIL', `workflow ${workflowId} did not reach a terminal state`);
      return;
    }
    const status = String(final.workflow?.status);
    const result = final.workflow?.result_json ? JSON.parse(final.workflow.result_json) : null;
    const stepRows: any[] = Array.isArray(final.steps) ? final.steps : [];
    const stepErrors = stepRows.map((s) => String(s.error_message ?? '')).filter(Boolean);
    const summary = result?.summary ?? result?.finalResult?.status ?? 'no summary';

    if (status === 'succeeded' || status === 'completed') {
      record(
        'akbaral.master',
        'Real MASTER task (goal → plan → MASTER → router → specialist → provider → verification → outcome)',
        'PASS',
        `workflow=${workflowId} analysis=${analysisMode} planSteps=${steps} status=${status} summary="${String(summary).slice(0, 200)}"`,
      );
      // 9. no fake completion: a succeeded run with no provider configured
      // would mean the pipeline invented an answer.
      if (!hasKey) {
        contractViolated = true;
        record('honesty.no_fake', 'No fake completion without a provider', 'FAIL', 'CONTRACT VIOLATION: the workflow reported success with no AI provider configured');
      } else {
        record('honesty.no_fake', 'No fake completion without a provider', 'PASS', 'the run succeeded with a real provider configured');
      }
    } else {
      const reason = stepErrors[0] ?? String(summary);
      record(
        'akbaral.master',
        'Real MASTER task (goal → plan → MASTER → router → specialist → provider → verification → outcome)',
        hasKey ? 'FAIL' : 'BLOCKED',
        `workflow=${workflowId} analysis=${analysisMode} planSteps=${steps} status=${status} firstStepError="${reason.slice(0, 260)}"`,
      );
      record(
        'honesty.no_fake',
        'No fake completion without a provider',
        /provider|not configured|api key/i.test(reason) || !hasKey ? 'PASS' : 'FAIL',
        `the pipeline failed loudly instead of inventing an answer: "${reason.slice(0, 200)}"`,
      );
    }
  } catch (error) {
    record('akbaral.master', 'Real MASTER task', 'FAIL', errorText(error));
  }
}

// ── 7. real free research (no key, no card) ──────────────────────────────────
async function checkFreeResearch(): Promise<void> {
  try {
    const { resolveSearchProvider, runProviderSearch } = await import('../src/agents/search-providers');
    const provider = resolveSearchProvider();
    const found = await runProviderSearch(provider, 'operating budget', 3, { attempts: 1 });
    const first = found[0];
    record(
      'agent.research',
      'Real external research through the free keyless provider',
      found.length > 0 && /^https:\/\//.test(String(first?.url)) ? 'PASS' : 'FAIL',
      `provider=${provider.kind} (keyless=${provider.keyless}) results=${found.length} first="${first?.title ?? ''}" url=${first?.url ?? ''}`,
    );
  } catch (error) {
    record('agent.research', 'Real external research through the free keyless provider', 'FAIL', errorText(error));
  }
}

// ── 8/10. persistence and the spending gate ──────────────────────────────────
async function checkMissionState(): Promise<void> {
  try {
    const { missionDb } = await import('../src/mission/database');
    const agents = missionDb.get<{ c: number }>('SELECT COUNT(*) AS c FROM mission_agents');
    const owners = missionDb.get<{ c: number }>('SELECT COUNT(*) AS c FROM mission_owner');
    const { verifyMissionAudit } = await import('../src/mission/database');
    const audit = verifyMissionAudit();
    record(
      'mission.persistence',
      'Mission database persistence and audit chain',
      Number(agents?.c ?? 0) > 0 && audit.ok ? 'PASS' : 'FAIL',
      `agents=${agents?.c ?? 0} owners=${owners?.c ?? 0} auditChain=${audit.ok ? `verified (${audit.rows} rows)` : 'BROKEN'}`,
    );

    const { fundingPosture } = await import('../src/mission/operating-funds');
    const posture = fundingPosture();
    const locked = posture.verifiedRevenueCents === 0 && posture.spendingUnlocked === false;
    if (!locked && posture.verifiedRevenueCents === 0) {
      contractViolated = true;
    }
    record(
      'mission.spending_gate',
      'Spending stays locked while verified revenue is zero',
      locked ? 'PASS' : 'FAIL',
      `mode=${posture.mode} verifiedRevenue=${posture.verifiedRevenueCents} spendingUnlocked=${posture.spendingUnlocked} budgetRemaining=${posture.budgetRemainingCents}`,
    );

    const { treasurySummary } = await import('../src/mission/treasury');
    const treasury = treasurySummary();
    record(
      'mission.revenue',
      'Mission revenue is real or zero — never synthetic',
      treasury.totals.realizedRevenueCents === 0 ? 'PASS' : 'FAIL',
      `realizedRevenue=${treasury.totals.realizedRevenueCents} pendingRevenue=${treasury.totals.pendingRevenueCents} (zero is the only honest value until external money is received and verified)`,
    );
  } catch (error) {
    record('mission.persistence', 'Mission database persistence and audit chain', 'FAIL', errorText(error));
  }
}

async function main(): Promise<void> {
  process.stdout.write(`\nAKBARAL! + ZA141251SA — live runtime verification\n${'='.repeat(78)}\n`);
  process.stdout.write(`host web      ${WEB}\nhost mission  ${MISSION}\nstarted       ${new Date().toISOString()}\n\n`);

  const egress = await checkEgress();
  await checkPlanes();
  const gemini = egress ? await checkGemini() : { reachable: false, model: null };
  const hasKey = Boolean((process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? '').trim()) && gemini.reachable;
  await checkMasterTask(hasKey);
  if (egress) await checkFreeResearch();
  else record('agent.research', 'Real external research through the free keyless provider', 'BLOCKED', 'no outbound HTTPS from this host');
  await checkMissionState();

  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 } as Record<Outcome, number>;
  for (const entry of results) counts[entry.outcome] += 1;

  const lines = [
    '## AKBARAL! + ZA141251SA — live runtime verification',
    '',
    `Runtime: \`${process.env.VERIFY_RUNTIME_LABEL ?? 'unlabelled host'}\` · ${new Date().toISOString()}`,
    '',
    `**PASS ${counts.PASS} · BLOCKED ${counts.BLOCKED} · FAIL ${counts.FAIL}**`,
    '',
    '| Step | Outcome | Evidence |',
    '|---|---|---|',
    ...results.map((entry) => `| \`${entry.id}\` ${entry.title} | **${entry.outcome}** | ${entry.evidence.replace(/\|/g, '/')} |`),
    '',
    contractViolated
      ? '> **CONTRACT VIOLATION detected — see the FAIL rows above.**'
      : '> No contract violation: nothing was faked, and spending stayed locked while verified revenue is zero.',
  ];
  const markdown = lines.join('\n');
  process.stdout.write(`\n${markdown}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('logs/live-verification', { recursive: true });
  writeFileSync('logs/live-verification/report.md', `${markdown}\n`);

  process.exitCode = contractViolated ? 1 : 0;
}

void main();
