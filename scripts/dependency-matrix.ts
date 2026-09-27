#!/usr/bin/env -S npx tsx
/**
 * One API / provider dependency matrix for both systems, printed from source.
 *
 *   npx tsx scripts/dependency-matrix.ts              # table
 *   npx tsx scripts/dependency-matrix.ts --json       # machine-readable
 *   npx tsx scripts/dependency-matrix.ts --missing    # only what is unset
 *   npx tsx scripts/dependency-matrix.ts --platforms  # earning-platform rules
 *   npx tsx scripts/dependency-matrix.ts --network    # which provider hosts this runtime can actually reach
 *
 * Nothing here reads a secret value: only whether a name is set. `usedBy` is
 * scanned from the source tree, so the matrix cannot drift from the code.
 */

import path from 'node:path';

import { dependencyMatrix, earningPlatformDependencies, staleMatrixRows, undocumentedEnvVars, type MatrixEntry } from '../src/config/dependency-matrix';
import { LEGITIMATE_SOURCES } from '../src/mission/opportunity-sources';

// Resolved from the process CWD so this runs under tsx, node and ts-node alike.
const root = path.resolve(process.cwd());
const args = process.argv.slice(2);
const rows = dependencyMatrix(root);

/** Unauthenticated reachability probes: no headers, no credentials, no bodies. */
async function probeNetwork(): Promise<void> {
  const targets = [
    ['Google Gemini (mission agent chat)', 'https://generativelanguage.googleapis.com/v1beta/models'],
    ['OpenAI', 'https://api.openai.com/v1/models'],
    ['Anthropic', 'https://api.anthropic.com/v1/models'],
    ['GitHub REST (opportunity ingestion)', 'https://api.github.com/zen'],
    ['npm registry (control)', 'https://registry.npmjs.org/-/ping'],
  ] as const;
  console.log('Outbound reachability from this runtime (unauthenticated probes, no credentials sent)');
  for (const [label, url] of targets) {
    const started = Date.now();
    try {
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
      console.log(`  REACHABLE       ${label} — HTTP ${response.status} in ${Date.now() - started}ms`);
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error instanceof Error ? error.name : 'error');
      console.log(`  RUNTIME BLOCKED ${label} — ${cause} after ${Date.now() - started}ms`);
    }
  }
}


function table(entries: MatrixEntry[]): void {
  const columns: Array<[string, (entry: MatrixEntry) => string]> = [
    ['PROVIDER', (entry) => entry.provider],
    ['ENV VAR', (entry) => entry.envVar],
    ['SYSTEM', (entry) => entry.system],
    ['STATUS', (entry) => `${entry.requirement}${entry.configured ? ' · set' : ' · unset'}`],
    ['FREE OPTION', (entry) => entry.freeOption ?? 'none'],
    ['CREDENTIAL', (entry) => entry.credential],
    ['THIS SANDBOX', (entry) => entry.sandbox],
    ['USED BY', (entry) => (entry.usedBy.length ? entry.usedBy.join(' ') : '—')],
    ['WITHOUT IT', (entry) => entry.breaksWithout],
  ];
  for (const entry of entries) {
    console.log('');
    for (const [label, read] of columns) console.log(`  ${label.padEnd(13)} ${read(entry)}`);
  }
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ generatedFrom: 'source scan', rows, undocumented: undocumentedEnvVars(root), stale: staleMatrixRows(root) }, null, 2));
} else if (args.includes('--network')) {
  void probeNetwork();
} else if (args.includes('--platforms')) {
  const platforms = earningPlatformDependencies(LEGITIMATE_SOURCES as unknown as Array<Record<string, unknown>>);
  const label = (value: number): string => (value === 1 ? 'API automation allowed' : value === 2 ? 'conditional — official API only, no scraping' : 'manual / owner only');
  console.log(`Earning platforms in the mission registry: ${platforms.length}`);
  console.log(`  with an API credential slot: ${platforms.filter((platform) => platform.envVar).length}`);
  console.log(`  usable without a key:        ${platforms.filter((platform) => !platform.envVar && platform.apiAvailable).length}`);
  for (const platform of platforms) {
    console.log('');
    console.log(`  ${platform.platform} (${platform.category})`);
    console.log(`    credential   ${platform.envVar ?? 'none required'}`);
    console.log(`    automation   ${label(platform.automationAllowed)}${platform.automationNotes ? ` — ${platform.automationNotes}` : ''}`);
    console.log(`    account      ${platform.accountRules || 'not stated'}`);
    console.log(`    eligibility  ${platform.countryEligibility.join(', ') || 'not stated'}`);
    console.log(`    payout       ${platform.payoutMethods.join(', ') || 'not stated'}`);
  }
} else {
  const entries = args.includes('--missing') ? rows.filter((row) => !row.configured && row.requirement !== 'OPTIONAL') : rows;
  const counts = {
    total: rows.length,
    configured: rows.filter((row) => row.configured).length,
    credentialRequired: rows.filter((row) => row.requirement === 'CREDENTIAL REQUIRED').length,
    ownerAction: rows.filter((row) => row.sandbox === 'owner action required (external account, KYC or OAuth consent)').length,
    withFreeOption: rows.filter((row) => row.freeOption).length,
  };
  console.log('API / provider dependency matrix — generated from source');
  console.log(`  ${counts.total} variables · ${counts.configured} set here · ${counts.credentialRequired} need a provider credential`);
  console.log(`  ${counts.withFreeOption} have a genuinely free option · ${counts.ownerAction} need an owner action outside this sandbox`);
  table(entries);
  const undocumented = undocumentedEnvVars(root);
  const stale = staleMatrixRows(root);
  console.log('');
  console.log(`Coverage: ${undocumented.length === 0 ? 'every runtime variable is documented' : `UNDOCUMENTED: ${undocumented.join(', ')}`}`);
  console.log(`Staleness: ${stale.length === 0 ? 'no row references a variable the runtime no longer reads' : `STALE: ${stale.join(', ')}`}`);
}
