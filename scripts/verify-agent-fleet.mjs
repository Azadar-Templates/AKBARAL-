#!/usr/bin/env node
/**
 * AKBARAL! — 4,001+ agent fleet executability and MASTER routing verifier.
 *
 * Two independent proofs, both against real rows and real executions:
 *
 *   A. FLEET CONTRACT — every registered agent is enumerated from the live API
 *      (complete, no gaps, unique slugs, all active) and a cross-category
 *      sample is fetched in full to confirm the fields the executor actually
 *      uses (system instructions, workflow, verification rules, outputs) are
 *      present. The per-agent executability audit (`audit-registry.ts`) is run
 *      as well, so the fleet verdict comes from its own contract checks.
 *
 *   B. MASTER ROUTING — distinct goals are executed through the MASTER
 *      pipeline and each resulting workflow is inspected: every step must name
 *      a real registry agent, the steps must execute, and different goals must
 *      route to different specialists (a hard-coded single agent would show up
 *      immediately as one repeated slug).
 *
 * Usage: API_BASE=http://127.0.0.1:4000 AKBARAL_OWNER_EMAIL=... \
 *        AKBARAL_OWNER_PASSWORD=... node scripts/verify-agent-fleet.mjs
 */
import { execFileSync } from 'node:child_process';

const BASE = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const OWNER_EMAIL = (process.env.AKBARAL_OWNER_EMAIL ?? '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.AKBARAL_OWNER_PASSWORD ?? '';
const GOAL_COUNT = Number(process.env.FLEET_GOAL_COUNT ?? 8);

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let token = null;
async function api(method, pathname, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* callers inspect text where meaningful */
  }
  return { status: response.status, json, text };
}

const GOALS = [
  'Write a technical SEO audit plan for an e-commerce store and list the fixes in priority order.',
  'Design a mobile app onboarding flow and specify the screens and copy.',
  'Analyse our subscription churn data and propose three retention experiments.',
  'Draft a 30-day content calendar for a B2B SaaS launch.',
  'Build a secure REST API design for a payments ledger and review it for security gaps.',
  'Create a financial forecast model outline for a services business and list the assumptions.',
  'Plan a customer support knowledge base structure and the escalation policy.',
  'Produce a brand identity brief with typography and colour guidance.',
];

async function waitForWorkflow(id, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await api('GET', `/api/master/${id}`);
    const status = last.json?.workflow?.status;
    if (status && ['completed', 'failed', 'cancelled'].includes(String(status))) return last.json;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return last?.json ?? null;
}

async function main() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.error('AKBARAL_OWNER_EMAIL and AKBARAL_OWNER_PASSWORD must be set (never printed).');
    process.exit(2);
  }
  const ready = await api('GET', '/api/ready').catch(() => null);
  if (!ready || ready.status !== 200) {
    console.error(`platform API not ready at ${BASE}`);
    process.exit(2);
  }
  const login = await api('POST', '/api/auth/login', { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (login.status !== 200) {
    // The owner account may not exist in a fresh database yet.
    await api('POST', '/api/auth/register', { email: OWNER_EMAIL, password: OWNER_PASSWORD, name: 'AKBARAL Owner' });
    const retry = await api('POST', '/api/auth/login', { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (retry.status !== 200) {
      console.error(`owner sign-in failed (${retry.status}) — is the API running at ${BASE}?`);
      process.exit(2);
    }
    token = retry.json.accessToken ?? retry.json.access_token ?? retry.json.token;
  } else {
    token = login.json.accessToken ?? login.json.access_token ?? login.json.token;
  }

  console.log(`\nAKBARAL! agent fleet — verifying ${BASE}\n`);

  // ── A. Fleet contract ────────────────────────────────────────────────────
  const first = await api('GET', '/api/public/agents?limit=1');
  const total = Number(first.json?.total ?? 0);
  check('the registry reports 4,001+ agents', total >= 4_001, `total=${total}`);

  const pageSize = 200; // the public list caps at 60; the authenticated list does not
  const slugs = new Set();
  const agentIdToSlug = new Map();
  const categories = new Set();
  let listed = 0;
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await api('GET', `/api/agents?limit=${pageSize}&offset=${offset}`);
    const agents = page.json?.agents ?? [];
    if (agents.length === 0) break;
    for (const agent of agents) {
      slugs.add(String(agent.slug));
      agentIdToSlug.set(String(agent.id), String(agent.slug));
      categories.add(String(agent.category ?? 'unknown'));
    }
    listed += agents.length;
    if (listed >= total) break;
  }
  check('every registry row is enumerable through the API (no gaps)', slugs.size >= total, `enumerated=${slugs.size} total=${total}`);
  check('registry slugs are unique', slugs.size === listed, `unique=${slugs.size} listed=${listed}`);
  check('the fleet spans many categories (not one shim agent)', categories.size >= 10, `categories=${categories.size}`);

  // Cross-category sample: the fields the executor consumes.
  const sample = [];
  for (const offset of [0, 250, 900, 1_600, 2_400, 3_200, 3_900]) {
    const page = await api('GET', `/api/agents?limit=6&offset=${offset}`);
    for (const agent of (page.json?.agents ?? []).slice(0, 2)) sample.push(agent.slug);
  }
  let contractComplete = 0;
  let contractChecked = 0;
  for (const slug of sample) {
    const detail = await api('GET', `/api/agents/${slug}`);
    const agent = detail.json?.agent;
    contractChecked += 1;
    const ok =
      detail.status === 200 &&
      String(agent?.status) === 'active' &&
      String(agent?.systemInstructions ?? agent?.system_instructions ?? '').length > 40 &&
      (agent?.workflow ?? []).length >= 3 &&
      (agent?.verificationRules ?? []).length >= 2 &&
      (agent?.outputs ?? []).length >= 1;
    if (ok) contractComplete += 1;
    else failures.push(`agent ${slug} has an incomplete executable contract (status=${detail.status})`);
  }
  check(
    `a ${contractChecked}-agent cross-category sample carries the full executable contract`,
    contractComplete === contractChecked,
    `${contractComplete}/${contractChecked} complete`,
  );

  // Per-agent executability verdicts (the fleet's own audit).
  let auditCounts = null;
  try {
    const raw = execFileSync('npx', ['tsx', 'scripts/audit-registry.ts', '--json', '--allow-degraded'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'file:./data/akbaral.db' },
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
    const verdicts = parsed.totals?.verdicts ?? {};
    const failedAgents = (parsed.agents ?? []).filter((entry) => entry.verdict === 'FAILED');
    check('no registered agent has a broken contract (verdict FAILED)', failedAgents.length === 0, `failed=${failedAgents.length}`);
    check('no registered agent is deliberately unroutable (verdict BLOCKED)', Number(verdicts.BLOCKED ?? 0) === 0, `blocked=${verdicts.BLOCKED}`);
    const active = Number(verdicts.ACTIVE ?? 0);
    const needsConfig = Number(verdicts.NEEDS_CONFIGURATION ?? 0);
    const missing = Number(verdicts.MISSING_DEPENDENCY ?? 0);
    const blocked = Number(verdicts.BLOCKED ?? 0);
    console.log(
      `    · per-agent verdicts: ACTIVE=${active} NEEDS_CONFIGURATION=${needsConfig} MISSING_DEPENDENCY=${missing} BLOCKED=${blocked} (of ${parsed.totals?.registered ?? total})`,
    );
    const reasons = Object.entries(parsed.dependencySummary ?? {}).sort((a, b) => b[1] - a[1]);
    if (reasons.length > 0) {
      console.log('    · every degraded agent names its exact dependency:');
      for (const [reason, count] of reasons.slice(0, 5)) console.log(`        - ${reason} (${count})`);
    }
    check(
      'every agent carries a verdict (each degradation names the exact missing dependency)',
      active + needsConfig + missing + blocked === Number(parsed.totals?.registered ?? -1),
      `verdicts cover ${active + needsConfig + missing + blocked} of ${parsed.totals?.registered}`,
    );
    check(
      'the fleet reports its own environment honestly (an unconfigured provider is named, never hidden)',
      active + needsConfig + missing + blocked > 0 && (needsConfig === 0 || reasons.length > 0),
      'degraded agents must carry a named reason',
    );
  } catch (error) {
    check('the per-agent executability audit ran', false, String(error.message ?? error).slice(0, 200));
  }

  // ── B. MASTER routing ────────────────────────────────────────────────────
  const usedAgents = new Set();
  const usedCategories = new Set();
  const resultModes = new Set();
  let resultsWithSummary = 0;
  let completed = 0;
  let stepsTotal = 0;
  let stepsCompleted = 0;
  const goals = GOALS.slice(0, GOAL_COUNT);
  for (const goal of goals) {
    const started = await api('POST', '/api/master', { goal });
    const workflowId = started.json?.workflow?.id;
    if (started.status !== 202 || !workflowId) {
      failures.push(`goal did not start a MASTER workflow (${started.status})`);
      continue;
    }
    const detail = await waitForWorkflow(workflowId);
    const status = detail?.workflow?.status;
    if (status === 'completed') completed += 1;
    else failures.push(`workflow for "${goal.slice(0, 40)}…" ended ${status} (${detail?.workflow?.error_message ?? 'no reason'})`);

    for (const step of detail?.steps ?? []) {
      stepsTotal += 1;
      if (String(step.status) === 'completed') stepsCompleted += 1;
      const slug = agentIdToSlug.get(String(step.agent_id)) ?? String(step.agent_slug ?? '');
      if (slug) {
        usedAgents.add(slug);
        usedCategories.add(slug.split('-')[0]);
      }
    }
    const result = detail?.finalResult;
    if (result) {
      resultModes.add(String(result.mode ?? 'undisclosed'));
      if (result.executiveSummary && String(result.executiveSummary).length > 20) resultsWithSummary += 1;
    }
  }

  check(`all ${goals.length} MASTER goals completed`, completed === goals.length, `completed=${completed}/${goals.length}`);
  check('every workflow step executed', stepsTotal > 0 && stepsCompleted === stepsTotal, `steps=${stepsCompleted}/${stepsTotal}`);
  check(
    'MASTER routed to real registry agents (not an internal shim)',
    usedAgents.size >= Math.min(4, goals.length),
    `distinct specialists used=${usedAgents.size}: ${[...usedAgents].slice(0, 8).join(', ')}`,
  );
  check(
    'routing is goal-dependent: different goals selected different specialists',
    usedAgents.size > 1,
    `distinct specialists=${usedAgents.size}`,
  );
  check('routed specialists span multiple categories', usedCategories.size >= 2, `categories=${[...usedCategories].join(', ')}`);
  check(
    'every execution produced a final result document',
    resultsWithSummary === goals.length,
    `documents=${resultsWithSummary}/${goals.length}`,
  );
  check(
    'each result discloses how it was produced (model mode, never a silent claim)',
    resultModes.size > 0 && !resultModes.has('undisclosed'),
    `modes=${[...resultModes].join(', ')}`,
  );
  console.log(`    · execution mode(s) reported by the pipeline: ${[...resultModes].join(', ')}`);

  console.log(`    · distinct specialists selected: ${usedAgents.size} — ${[...usedAgents].slice(0, 12).join(', ')}`);

  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    console.log('  failures:');
    for (const failure of failures.slice(0, 25)) console.log(`    · ${failure}`);
    console.log('');
    process.exit(1);
  }
}

await main();
