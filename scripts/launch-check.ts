/**
 * `npm run launch:check` — production launch verification.
 *
 * Runs every launch check (configuration facts + live provider probes) and
 * prints:
 *   1. a per-check table with honest evidence,
 *   2. the exact blockers that remain,
 *   3. the exact owner actions required outside this repository,
 *   4. a readiness percentage over the required checks,
 *   5. optionally, a markdown report written to a file (`--report <path>`).
 *
 * Flags:
 *   --offline     configuration only: never touches the network
 *   --deep        enable the more expensive "real work" probes (Gemini
 *                 generation call, live search query)
 *   --only <id>   run a subset (repeatable; matches id or area, case-insensitive)
 *   --json        machine-readable output instead of the human report
 *   --report <p>  write a markdown report
 *   --fail-on-blockers  exit 1 when any REQUIRED check is not ready
 *
 * Secrets are never printed: results carry variable names and provider status
 * codes only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runLaunchChecks, readinessPercent, type CheckStatus, type LaunchReport } from '../src/launch/checks';

const ICONS: Record<CheckStatus, string> = {
  ready: '✓',
  not_configured: '•',
  unreachable: '~',
  failed: '✗',
  optional: '–',
};

const LABELS: Record<CheckStatus, string> = {
  ready: 'ready',
  not_configured: 'not configured',
  unreachable: 'unreachable',
  failed: 'FAILED',
  optional: 'optional / absent',
};

function parseArgs(argv: string[]): { offline: boolean; deep: boolean; json: boolean; only: string[]; report: string | null; failOnBlockers: boolean } {
  const options = { offline: false, deep: false, json: false, only: [] as string[], report: null as string | null, failOnBlockers: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--offline') options.offline = true;
    else if (arg === '--deep') options.deep = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--fail-on-blockers') options.failOnBlockers = true;
    else if (arg === '--only') options.only.push(String(argv[++index] ?? ''));
    else if (arg === '--report') options.report = String(argv[++index] ?? '');
  }
  return options;
}

function renderHuman(report: LaunchReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('AKBARAL! — production launch verification');
  lines.push('='.repeat(72));
  lines.push(`  environment   ${report.nodeEnv}${report.mode.offline ? '  (offline: no network probes)' : ''}${report.mode.deep ? '  (deep probes)' : ''}`);
  lines.push(`  generated     ${report.generatedAt}`);
  lines.push('');
  let area = '';
  for (const check of report.checks) {
    if (check.area !== area) {
      area = check.area;
      lines.push(`  ${area}`);
    }
    const flag = check.required ? ' ' : 'opt';
    lines.push(`    ${ICONS[check.status]} [${flag}] ${check.title}`);
    lines.push(`          ${LABELS[check.status]} — ${check.evidence}`);
    if (check.envKeys.length > 0) lines.push(`          env: ${check.envKeys.join(', ')}`);
  }
  lines.push('');
  lines.push('─'.repeat(72));
  const percent = readinessPercent(report);
  lines.push(`  readiness (required checks): ${percent}%   (${report.summary.ready}/${report.summary.total} checks ready, ${report.summary.requiredNotReady} blocker(s))`);
  if (report.blockers.length > 0) {
    lines.push('');
    lines.push('  REMAINING BLOCKERS');
    for (const blocker of report.blockers) {
      lines.push(`    ✗ ${blocker.title} (${blocker.id}) — ${LABELS[blocker.status]}`);
      lines.push(`      ${blocker.evidence}`);
    }
  } else {
    lines.push('');
    lines.push('  No blockers: every required check is ready.');
  }
  if (report.ownerActions.length > 0) {
    lines.push('');
    lines.push('  OWNER ACTIONS (outside this repository)');
    report.ownerActions.forEach((action, index) => lines.push(`    ${index + 1}. ${action}`));
  }
  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(report: LaunchReport): string {
  const lines: string[] = [];
  lines.push('# AKBARAL! launch verification report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt} · environment: \`${report.nodeEnv}\`${report.mode.offline ? ' · offline (configuration only)' : ''}${report.mode.deep ? ' · deep probes' : ''}`);
  lines.push('');
  lines.push(`**Readiness (required checks): ${readinessPercent(report)}%** — ${report.summary.ready} of ${report.summary.total} checks ready, ${report.summary.requiredNotReady} blocker(s).`);
  lines.push('');
  lines.push('| Check | Area | Required | Status | Evidence |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(`| ${check.title} | ${check.area} | ${check.required ? 'yes' : 'no'} | ${LABELS[check.status]} | ${check.evidence.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Blockers');
  if (report.blockers.length === 0) {
    lines.push('');
    lines.push('None: every required check is ready.');
  } else {
    for (const blocker of report.blockers) {
      lines.push('');
      lines.push(`- **${blocker.title}** (\`${blocker.id}\`) — ${LABELS[blocker.status]}`);
      lines.push(`  - ${blocker.evidence}`);
      if (blocker.ownerAction) lines.push(`  - Owner action: ${blocker.ownerAction}`);
    }
  }
  lines.push('');
  lines.push('## Owner actions');
  if (report.ownerActions.length === 0) {
    lines.push('');
    lines.push('None.');
  } else {
    lines.push('');
    report.ownerActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runLaunchChecks({
    offline: options.offline,
    deep: options.deep,
    only: options.only.filter(Boolean),
    cwd: process.cwd(),
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ readinessPercent: readinessPercent(report), ...report }, null, 2)}\n`);
  } else {
    process.stdout.write(renderHuman(report));
  }

  if (options.report) {
    const target = path.isAbsolute(options.report) ? options.report : path.join(process.cwd(), options.report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderMarkdown(report));
    if (!options.json) process.stdout.write(`  report written to ${options.report}\n\n`);
  }

  if (options.failOnBlockers && report.blockers.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`launch:check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
