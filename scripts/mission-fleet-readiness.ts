/**
 * ZA141251SA fleet readiness report — `npm run fleet:readiness`
 *
 * Answers one question with live rows and nothing else: of the registered specialist
 * fleet, how many can actually be handed real, permitted earning work right now, and
 * exactly what stands in the way of the rest. Registration counts, green tests and
 * schema presence are deliberately NOT reported as readiness.
 *
 * Read-only by default. Two opt-in modes:
 *   --reconcile   roll the blockers up into the owner's human-action queue
 *                 (idempotent: one open task per blocker code, never duplicated)
 *   --discover    run the real GitHub-issue bounty discovery pass through the same
 *                 client the worker uses (public API, read-only, no token required).
 *                 Discovery is allowlist-gated: with no active bounty program it
 *                 searches nothing and says so, rather than crawling at random.
 *
 * Env: ZA141251SA_DATABASE_URL (default ./data/mission.db), ZA141251SA_SESSION_SECRET,
 * ZA141251SA_GITHUB_TOKEN (optional, only raises the GitHub rate budget).
 */
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import { fleetSummary, reconcileOwnerActions, readinessReportId } from '../src/mission/earning/fleet-readiness';
import { verificationLedgerSummary } from '../src/mission/earning/result-verification';
import { allowlistedRepoNames } from '../src/mission/earning/github-bounty-scope-gate';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const reconcile = argv.includes('--reconcile');
const discover = argv.includes('--discover');
const unknown = argv.filter(a => !['--json', '--reconcile', '--discover'].includes(a));
if (unknown.length > 0) {
  process.stderr.write(`unknown argument: ${unknown[0]} (expected --json, --reconcile, --discover)\n`);
  process.exit(2);
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(38, '.')} ${value}\n`);
}

async function main(): Promise<void> {
  applyMissionMigrations();

  if (discover) {
    const { configuredGithubBountyClient } = await import('../src/mission/earning/github-bounty-client');
    const { GithubBountyWorkflow } = await import('../src/mission/earning/github-bounty-workflow');
    const client = configuredGithubBountyClient(process.env);
    const scoped = allowlistedRepoNames();
    process.stdout.write(`\n  github discovery: authenticated=${client.authenticated} scoped_repos=${scoped.repos.length} truncated=${scoped.truncated}\n`);
    if (scoped.repos.length === 0) {
      process.stdout.write('  skipped: no active bounty program with an exact repo allow row (scope gate is fail-closed by design)\n');
    } else {
      const ownerRow = missionDb.get<Row>("SELECT id FROM mission_owner WHERE status='active' LIMIT 1");
      if (!ownerRow) process.stdout.write('  skipped: no active mission owner to attribute the discovery run to\n');
      else {
        const workflow = new GithubBountyWorkflow(client);
        const leads = await workflow.discover({ kind: 'owner', id: String(ownerRow.id) });
        const accepted = leads.filter(r => String(r.risk_state) === 'accepted');
        process.stdout.write(`  leads recorded=${leads.length} accepted_by_risk_screen=${accepted.length}\n`);
        for (const r of accepted.slice(0, 15)) {
          process.stdout.write(`    · ${String(r.repo_full_name)}#${String(r.issue_number)} ${String(r.issue_url)}\n`);
        }
      }
    }
  }

  const summary = fleetSummary();
  const ledger = verificationLedgerSummary();

  if (asJson) {
    process.stdout.write(JSON.stringify({ reportId: readinessReportId(), ...summary, resultVerification: ledger }, null, 2) + '\n');
  } else {
    process.stdout.write('\nAKBARAL! fleet readiness — measured from live mission rows only\n');
    process.stdout.write('═'.repeat(78) + '\n');
    line('report id', readinessReportId());
    line('generated', summary.generatedAt);

    process.stdout.write('\n  the eight counts that matter\n');
    line('1. agents registered', String(summary.counts.registeredAgents));
    line('2. tools valid + executable', `${summary.tooling.executable} executable / ${summary.tooling.registered} registered (${summary.tooling.restricted} restricted, ${summary.tooling.blocked} blocked)`);
    line('3. execution-ready agents', `${summary.counts.executionReadyAgents} (active grant + scoped contract + credential + ready connector, no open owner task)`);
    line('4. verified platform access', String(summary.counts.agentsWithVerifiedPlatformAccess));
    line('5. eligible tasks assignable', String(summary.counts.eligibleTasksAssignable));
    line('6. assigned / in flight', String(summary.counts.assignedEligibleTasks));
    line('7. completed with evidence', `${summary.counts.completedWithEvidence} (${ledger.evidenceRows} evidence rows, ${ledger.productionPasses} production verifier passes)`);
    line('8. independently verified revenue', `${summary.counts.independentlyVerifiedRevenueCents} cents received (verifier-backed)`);
    line('9. settled payouts', `${summary.counts.settledPayoutCents} cents (settlement ref present)`);
    line('agents starting concurrently', String(summary.counts.startingConcurrently));
    line('agents blocked', String(summary.counts.blockedAgents));
    process.stdout.write(`      ${summary.note}\n`);

    process.stdout.write('\n  connectors\n');
    line('earning + infra connectors', `${summary.connectors.total} total · ${summary.connectors.ready} ready · ${summary.connectors.notConfigured} awaiting credentials · ${summary.connectors.restricted} restricted · ${summary.connectors.blocked} blocked · ${summary.connectors.degraded} degraded`);

    process.stdout.write('\n  blockers (each names a free or owner-side path, never a workaround)\n');
    if (summary.blockers.length === 0) line('none', 'nothing gates the fleet right now');
    for (const b of summary.blockers) {
      line(`${b.code} [${b.scope}]`, `${b.agentsAffected} agent(s) — ${b.label}`);
      process.stdout.write(`      free path: ${b.freePath}\n`);
    }

    process.stdout.write('\n  gates\n');
    line('autonomous execution', summary.gates.policy.autonomousEnabled ? 'enabled' : 'DISABLED (owner switch)');
    line('kill switch', summary.gates.policy.killSwitch ? 'ENGAGED' : 'off');
    line('policy max agents / day spend cap', `${summary.gates.policy.maxAgents} agents · ${summary.gates.policy.dailySpendCapCents} cents`);
    line('payout slots', `${summary.gates.payoutSlots.verified} verified of ${summary.gates.payoutSlots.total} · owner approval ${summary.gates.policy.requireOwnerForPayout ? 'required' : 'not required'}`);
    line('fixture-origin agents (excluded)', String(summary.counts.fixtureOriginAgents));
  }

  if (reconcile) {
    const result = reconcileOwnerActions();
    process.stdout.write(`\n  owner actions: ${result.created.length} created, ${result.existing.length} already open, ${result.openTotal} pending total\n`);
    for (const code of result.created) process.stdout.write(`    + queued ${code}\n`);
  }
  if (!asJson) process.stdout.write('\n  Read-only report. Nothing here was executed, paid, or inferred from tests.\n\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`fleet readiness failed: ${String((error as { message?: string })?.message ?? error)}\n`);
  process.exit(1);
});
