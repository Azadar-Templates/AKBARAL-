#!/usr/bin/env node
/**
 * AKBARAL! — REAL production E2E verification (MASTER flow through Gemini).
 *
 * Runs the complete user-visible production flow against a live AKBARAL!
 * deployment and gathers honest evidence about the REAL provider path:
 *
 *   request → task creation → planning → agent/model selection →
 *   real Gemini request → real Google response → verification →
 *   finalResult → MASTER rendering payload → Task Center result
 *
 * Usage:
 *   AKBARAL_BASE_URL=https://azadar-templates--akbaral.modal.run \
 *     node scripts/verify-production-e2e.mjs
 *
 *   # against the local preview stack ONLY while developing assertions
 *   # (fixture answers are then permitted and labelled as such):
 *   AKBARAL_BASE_URL=http://127.0.0.1:3000 node scripts/verify-production-e2e.mjs --allow-fixture
 *
 * No credentials are needed or printed: registration is a public API; the
 * GOOGLE_API_KEY lives only in the deployment's secret store and is asserted
 * to stay out of every response surface.
 *
 * Exit code 0 = every check passed.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Crash visibility: if anything throws unhandled (e.g. network), report it as
// an annotation so the failure mode is diagnosable without raw log access.
process.on('unhandledRejection', (err) => {
  console.log(`::error title=E2E crashed::${String(err).slice(0, 280).replace(/%/g, '%25').replace(/\r?\n/g, ' ')}`);
  console.error(err);
  process.exit(1);
});

const BASE = (process.env.AKBARAL_BASE_URL ?? 'https://aztar-templates--invalid.example').replace(/\/+$/, '');
if (BASE.includes('invalid.example')) {
  console.error('Set AKBARAL_BASE_URL (e.g. https://azadar-templates--akbaral.modal.run)');
  process.exit(2);
}
const ALLOW_FIXTURE = process.argv.includes('--allow-fixture');
const GOAL = 'What is AKBARAL! in 5 short bullet points';
const CURRENT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
// The preview fixture's canned answer — a REAL Google response must never be
// byte-identical to it (anti-mock evidence, not a content requirement).
const FIXTURE_OPENING = '## AKBARAL! in 5 bullet points';
const FIXTURE_SIGNATURE = 'One intelligence system**: AKBARAL! is an autonomous operating system for work';

let failures = 0;
let warnings = 0;
// In CI, mirror every FAIL as a GitHub Actions annotation (::error::) — the
// annotations API is readable even when raw log download is blocked.
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) {
    failures += 1;
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=E2E check failed::${label.replace(/%/g, '%25').replace(/\r?\n/g, ' ')}`);
  }
};
const warn = (cond, label) => { if (!cond) { warnings += 1; console.log(`WARN  ${label}`); } };

const surfaces = []; // every response body seen — scanned for key material at the end
const grab = (text) => { surfaces.push(String(text)); return String(text); };
const j = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, init);
  const text = grab(await res.text());
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON surface */ }
  return { res, body, text };
};

console.log(`AKBARAL! production E2E — target: ${BASE}${ALLOW_FIXTURE ? '  [fixture answers PERMITTED — local development only]' : '  [REAL provider responses required]'}`);
console.log(`goal: "${GOAL}"\n`);

// ── 1. Liveness + readiness (production database round trip) ──────────────
const health = await j('/api/health');
// Modal's edge refuses everything with 404 + this body when the workspace is
// disabled (account/billing state) — surface it explicitly instead of a
// confusing wall of 404s.
if (/modal-http:\s*workspace\s+\S+\s+is disabled/i.test(health.text)) {
  const notice = (/\S+\s+is disabled/i.exec(health.text) ?? [''])[0];
  console.log(`\nPRODUCTION BLOCKED: the Modal workspace is disabled — ${notice}`);
  console.log('Modal is refusing every request at its edge; the app never receives them.');
  console.log('Fix (user-side): reactivate the workspace in the Modal dashboard (billing/plan), then re-run this verification.');
  process.exit(3);
}
ok(health.res.status === 200 && health.body?.status === 'ok', `GET /api/health -> ${health.res.status} (status: ${health.body?.status}, db: ${health.body?.checks?.database ?? health.body?.database ?? 'n/a'})`);
const ready = await j('/api/ready');
ok(ready.res.status === 200 && ready.body?.status === 'ready', `GET /api/ready -> ${ready.res.status} (status: ${ready.body?.status})`);

// ── 2. Web shell through the production proxy ─────────────────────────────
const page = await j('/');
ok(page.res.status === 200 && page.text.includes('id="app-root"'), `GET / -> ${page.res.status}, app shell mounts #app-root`);
const appJs = await j('/assets/app.js?v=akbaral-lux-13');
ok(appJs.res.status === 200 && appJs.text.includes('renderTaskOutcome'), 'app.js serves the MASTER outcome renderer');
const appJsCompressed = await j('/assets/app.js?v=akbaral-lux-13', { headers: { 'accept-encoding': 'br, gzip' } });
ok(['br', 'gzip'].includes(appJsCompressed.res.headers.get('content-encoding') ?? '') && /max-age=86400/.test(appJsCompressed.res.headers.get('cache-control') ?? ''),
  `app.js compresses + caches (${appJsCompressed.res.headers.get('content-encoding') ?? 'identity'}, ${appJsCompressed.res.headers.get('cache-control') ?? 'none'})`);

// ── 3. Fresh account via the public API ───────────────────────────────────
const email = `prod-verify-${Date.now()}@akbaral.test`;
const password = `pv-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
await j('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, name: 'Production Verify' }) });
const login = await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
ok(Boolean(login.body?.accessToken), `register + login -> accessToken issued (${email})`);
const auth = { 'content-type': 'application/json', authorization: `Bearer ${login.body.accessToken}` };

// ── 4. Provider availability (PROVES the runtime has GOOGLE_API_KEY set) ──
const models = await j('/api/models', { headers: auth });
const googleModels = (models.body?.models ?? []).filter((m) => m.provider === 'google');
const googleAvailable = googleModels.filter((m) => m.available).map((m) => m.key);
ok(googleAvailable.length > 0, `google provider AVAILABLE in this runtime (key configured): ${googleAvailable.join(', ') || 'NONE'}`);
ok(googleAvailable.some((k) => CURRENT_MODELS.includes(k)), `an available CURRENT Gemini model is offered (${googleAvailable.filter((k) => CURRENT_MODELS.includes(k)).join(', ') || 'none'})`);

// ── 5. Credits BEFORE ─────────────────────────────────────────────────────
const meBefore = await j('/api/me', { headers: auth });
const creditsBefore = meBefore.body?.user?.freeCredits;
ok(typeof creditsBefore === 'number' && creditsBefore >= 1, `credits BEFORE: ${creditsBefore} (must be ≥ 1 to run)`);

// ── 6. THE EXACT GOAL through the MASTER flow ─────────────────────────────
const plannedAt = Date.now();
const plan = await j('/api/workflows/master', { method: 'POST', headers: auth, body: JSON.stringify({ goal: GOAL }) });
ok(Boolean(plan.body?.workflow?.id), `MASTER plan accepted: workflow ${plan.body?.workflow?.id} (${plan.body?.plan?.steps?.length ?? 0} step(s), agent: ${plan.body?.plan?.steps?.[0]?.agentSlug ?? plan.body?.plan?.steps?.[0]?.agent ?? 'n/a'})`);
const workflowId = plan.body.workflow.id;
await j(`/api/workflows/${workflowId}/run`, { method: 'POST', headers: auth, body: '{}' });

let wf = null;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  await sleep(2000);
  wf = (await j(`/api/workflows/${workflowId}`, { headers: auth })).body?.workflow;
  if (['completed', 'failed', 'cancelled'].includes(wf?.status)) break;
}
const runSeconds = ((Date.now() - plannedAt) / 1000).toFixed(1);
ok(wf?.status === 'completed', `workflow ${wf?.status ?? 'TIMEOUT'} in ${runSeconds}s (error: ${wf?.error_message ?? 'none'})`);

// ── 7. REAL-Google evidence (not fixture evidence) ────────────────────────
const parsed = wf?.result_json ? JSON.parse(wf.result_json) : {};
const finalResult = parsed.finalResult ?? parsed;
const sections = (finalResult.sections ?? []).filter((s) => s.status === 'completed');
const answerText = String(sections[0]?.content ?? '');
const isFixtureText = answerText.includes(FIXTURE_OPENING) && answerText.includes(FIXTURE_SIGNATURE);
if (ALLOW_FIXTURE) {
  warn(!isFixtureText, 'answer is the FIXTURE canned text — labelled, permitted only for local development');
} else {
  ok(!isFixtureText, 'answer is NOT the fixture canned text (real provider response)');
  ok(Number(runSeconds) >= 1.5, `realistic provider latency: ${runSeconds}s ≥ 1.5s (fixture responds ~instantly)`);
}
ok(sections.length >= 1 && /AKBARAL/i.test(answerText), `finalResult carries a real answer about AKBARAL (${answerText.length} chars)`);

// ── 8. Selected model + verification (from the execution logs) ────────────
const taskList = await j('/api/tasks', { headers: auth });
const completedTask = (taskList.body?.tasks ?? []).find((t) => ['completed', 'succeeded'].includes(String(t.status)));
ok(Boolean(completedTask), `Task Center lists the completed task (${completedTask?.id ?? 'none'})`);
if (!completedTask) {
  // Graceful failure path: a failed/cancelled workflow must produce a clean
  // report (with the workflow's own error) — never an unhandled crash.
  console.log(`      workflow status: ${wf?.status ?? 'unknown'}; error: ${wf?.error_message ?? 'none'}`);
  const meFail = await j('/api/me', { headers: auth });
  console.log(`      credits after failed run: ${meFail.body?.user?.freeCredits} (before ${creditsBefore}) — refund behavior observable above`);
  console.log('\nPRODUCTION E2E: FAILED (workflow did not complete — no task to inspect)');
  process.exit(1);
}
const detail = await j(`/api/tasks/${completedTask.id}`, { headers: auth });
const detailText = detail.text;
const modelLogLines = (detail.body?.logs ?? [])
  .map((l) => String(l.message ?? ''))
  .filter((m) => /gemini-[0-9.]+-flash|gemini-\d/.test(m));
const modelLine = modelLogLines.find((m) => /google/i.test(m)) ?? modelLogLines[0] ?? '';
const selectedModel = (/(gemini-[0-9a-z.\-]+)/.exec(modelLine) ?? [])[1] ?? null;
ok(CURRENT_MODELS.includes(selectedModel), `selected model: ${selectedModel ?? 'UNKNOWN'} (${CURRENT_MODELS.join(' / ')})`);
ok(/verification passed/i.test(modelLine) || /verification/i.test(modelLine), `verification log present: "${modelLine.slice(0, 120)}"`);
ok(/research-researcher-\d+/.test(detailText), `the dispatched agent is in the record (${(/(research-researcher-\d+)/.exec(detailText) ?? [])[1] ?? 'not found'})`);

// ── 9. finalResult → MASTER rendering payload contract ────────────────────
ok(typeof finalResult.executiveSummary === 'string' && finalResult.executiveSummary.length > 0, 'executiveSummary present for renderTaskOutcome');
ok(!/something went wrong/i.test(detailText), 'no error copy anywhere in the result surfaces');

// ── 10. Credits AFTER — exactly one consumed, no double-spend ─────────────
const meAfter = await j('/api/me', { headers: auth });
const creditsAfter = meAfter.body?.user?.freeCredits;
ok(creditsBefore - creditsAfter === 1, `credits AFTER: ${creditsAfter} — exactly 1 consumed (before ${creditsBefore}), no double consumption`);

// ── 11. Key-security: the GOOGLE_API_KEY never appears on any surface ─────
const leaked = surfaces.filter((s) => /AIza[0-9A-Za-z_\-]{30,}/.test(s));
ok(leaked.length === 0, 'no Google key material (AIza…) on any response surface');
const keyEcho = surfaces.filter((s) => /x-goog-api-key|GOOGLE_API_KEY\s*=/.test(s));
ok(keyEcho.length === 0, 'no key header/name echoed on any response surface');

console.log('── answer excerpt (first 240 chars of what the MASTER screen renders):');
console.log(answerText.slice(0, 240).replace(/\n/g, ' '));
console.log('── executive summary (first 160 chars):');
console.log(String(finalResult.executiveSummary ?? '').slice(0, 160).replace(/\n/g, ' '));

if (warnings > 0) console.log(`\n${warnings} warning(s)`);
console.log(failures === 0
  ? `\nPRODUCTION E2E: ALL ${ALLOW_FIXTURE ? 'CHECKS PASSED (fixture mode — NOT production evidence)' : 'CHECKS PASSED — real production evidence above'}`
  : `\nPRODUCTION E2E: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
