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
 *                 client the worker uses (public API, read-only, no token required),
 *                 then re-check each accepted lead's LIVE claim state — assignees,
 *                 maintainer claims, competing PRs, stated payment and acceptance
 *                 criteria — because discovery acceptance is not payability.
 *                 Discovery is allowlist-gated: with no active bounty program it
 *                 searches nothing and says so, rather than crawling at random.
 *   --backends    probe the four execution gates for real: sandbox (OCI pin + kernel
 *                 namespace jail), model dispatch, GitHub credential presence, payout
 *                 verification. Reads config and runs capability probes; mutates nothing.
 *   --contracts   prepare least-privilege scoped contracts for one agent class
 *                 (default bounty_research), bounded by --limit. Prepared, never granted:
 *                 an owner must approve each frozen permission set.
 *   --contracts-approve=<id>   owner-only activation of one prepared proposal.
 *   --pilot=<opportunityId>    drive ONE recorded lead through the real pipeline:
 *                 policy check, live claim recheck, exclusive assignment, sandbox
 *                 execution and test run, ending at a locally drafted candidate.
 *                 It never opens a pull request and never records revenue.
 *
 * --limit=N caps the rows a --contracts or --discover pass touches (default 25).
 *
 * Env: ZA141251SA_DATABASE_URL (default ./data/mission.db), ZA141251SA_SESSION_SECRET,
 * ZA141251SA_GITHUB_TOKEN (optional, only raises the GitHub rate budget).
 */
import { createHash } from 'node:crypto';
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import { fleetSummary, reconcileOwnerActions, readinessReportId } from '../src/mission/earning/fleet-readiness';
import { verificationLedgerSummary } from '../src/mission/earning/result-verification';
import { allowlistedRepoNames } from '../src/mission/earning/github-bounty-scope-gate';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const reconcile = argv.includes('--reconcile');
const discover = argv.includes('--discover');
const flags = new Set(['--json', '--reconcile', '--discover', '--backends']);
const option = (name: string): string | null => {
  const hit = argv.find(argument => argument.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const named = (name: string): string | null => {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return option(name);
};
const contractsClass = named('contracts');
const approveProposal = option('contracts-approve');
const pilotOpportunity = option('pilot');
const limit = (() => {
  const raw = option('limit');
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 25;
})();
const backends = argv.includes('--backends');
const contractsRequested = argv.includes('--contracts');
const unknown = argv.filter(argument => !flags.has(argument) && !/^--(contracts|limit|pilot|contracts-approve)(=|$)/.test(argument));
if (unknown.length > 0) {
  process.stderr.write(`unknown argument: ${unknown[0]} (expected --json, --reconcile, --discover, --backends, --contracts [class], --contracts-approve=<id>, --pilot=<opportunityId>, --limit=N)\n`);
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
        const actor = { kind: 'owner' as const, id: String(ownerRow.id) };
        const leads = await workflow.discover(actor);
        const accepted = leads.filter(r => String(r.risk_state) === 'accepted');
        process.stdout.write(`  leads recorded=${leads.length} accepted_by_risk_screen=${accepted.length}\n`);
        for (const r of accepted.slice(0, 15)) {
          process.stdout.write(`    · ${String(r.repo_full_name)}#${String(r.issue_number)} ${String(r.issue_url)}\n`);
        }
        // A lead only becomes work after its live claim is rechecked. One request per lead,
        // in order, so a discovery pass cannot spend the provider budget by accident.
        if (accepted.length > 0) {
          process.stdout.write('\n  live claim recheck (discovery acceptance is not payability)\n');
          let payable = 0;
          for (const lead of accepted.slice(0, limit)) {
            try {
              const policyRow = await workflow.checkPolicy(actor, String(lead.id));
              if (!Number(policyRow?.ai_contributions_allowed ?? 0)) {
                process.stdout.write(`    ✗ ${String(lead.repo_full_name)}#${String(lead.issue_number)} — repo policy prohibits AI contributions\n`);
                continue;
              }
              const verdict = await workflow.recheckEligibility(actor, String(lead.id));
              const evidence = String(verdict.claim_evidence_json ?? '[]');
              if (String(verdict.claim_state) === 'payable') payable += 1;
              process.stdout.write(`    ${String(verdict.claim_state) === 'payable' ? '✓' : '✗'} ${String(lead.repo_full_name)}#${String(lead.issue_number)} — ${String(verdict.claim_state)}${verdict.claim_reason ? ` (${String(verdict.claim_reason)})` : ''}${evidence.length > 4 ? ` ${evidence.slice(0, 160)}` : ''}\n`);
            } catch (error) {
              process.stdout.write(`    ! ${String(lead.repo_full_name)}#${String(lead.issue_number)} — refused: ${String((error as Error).message).slice(0, 120)}\n`);
            }
            await new Promise(resolveTimeout => setTimeout(resolveTimeout, 1500));
          }
          process.stdout.write(`  payable to us right now: ${payable}\n`);
        }
      }
    }
  }

  if (backends) {
    const { executionBackends } = await import('../src/mission/earning/execution-backends');
    const report = await executionBackends({ probeSandbox: true });
    if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else {
      process.stdout.write('\nexecution backends — probed on this host, never assumed\n');
      process.stdout.write('═'.repeat(78) + '\n');
      line('sandbox backend', `${report.sandbox.backend ?? 'none'} (mode ${report.sandbox.mode}${report.sandbox.reason ? `, reason ${report.sandbox.reason}` : ''})`);
      line('oci image pinned', report.sandbox.oci.imageDigestPinned ? `yes @ ${report.sandbox.oci.repository}` : 'no digest pinned');
      line('namespace jail probe', `${report.sandbox.namespace.available ? 'available' : `unavailable: ${report.sandbox.namespace.reason ?? 'unknown'}`}${report.sandbox.namespace.rootfsDigestPinned ? ', rootfs pinned' : ', rootfs unpinned'}`);
      const boundary = report.sandbox.namespace.detail.boundary as Record<string, unknown> | null | undefined;
    line('namespace jail boundary', boundary && Object.keys(boundary).length > 0
      ? JSON.stringify(boundary)
      : 'not probed by this report; the runner proves host/PID/egress isolation before the first execution and goes unavailable if it fails');
      line('model dispatch', `${report.model.mode} · ${report.model.dispatchable ? 'dispatchable' : 'blocked'} · model ${report.model.model} · configs ${report.model.agentsWithChatConfig}/${report.model.productionAgents} agents (free-tier basis: ${report.model.agentsOnFreeTierBasis})`);
      line('model fallback', `${report.model.fallback.configured} provider(s) registered, ${report.model.fallback.providersEnabled} enabled, fallback ${report.model.fallback.supported ? 'supported' : 'not applicable yet'}`);
      line('github credential', `${report.github.credentialPresent ? 'present (value never read)' : 'absent'} · read paths available`);
      line('payout slots', `${report.payout.slotsVerified} payable of ${report.payout.slotsConfigured} configured of ${report.payout.slots.length} · rails ${report.payout.rails.join(',')}`);
      process.stdout.write('\n  what is still blocked\n');
      if (report.blocked.length === 0) line('nothing', 'all four gates are open on this host');
      for (const entry of report.blocked) line(`${entry.gate}`, entry.reason);
      process.stdout.write('\n  owner actions\n');
      for (const action of [...report.sandbox.ownerActions, ...report.model.ownerActions]) line('·', action);
      process.stdout.write('\n  submission never runs from the fleet: it stays an owner-authorized action.\n\n');
    }
  }

  if (approveProposal) {
    const { approveClassContractProposal } = await import('../src/mission/earning/agent-class-contracts');
    const ownerRow = missionDb.get<Row>("SELECT id FROM mission_owner WHERE status='active' LIMIT 1");
    if (!ownerRow) { process.stderr.write('no active mission owner to attribute the approval to\n'); process.exit(1); }
    const contract = approveClassContractProposal({ kind: 'owner', id: String(ownerRow.id) }, approveProposal, 'approved from the operator console');
    process.stdout.write(`\n  contract ${String(contract.id)} activated for agent ${String(contract.agent_id)} (${String(contract.purpose)}) — expires ${String(contract.expires_at)}\n`);
    process.stdout.write('  this is a permission grant; it was authorized by the owner running this command, not by the fleet.\n\n');
    return;
  }

  if (contractsClass !== null || contractsRequested) {
    const agentClass = contractsClass === null ? 'bounty_research' : contractsClass;
    const { classContractDefinition, prepareClassContractsForClass, listClassContractProposals } = await import('../src/mission/earning/agent-class-contracts');
    const ownerRow = missionDb.get<Row>("SELECT id FROM mission_owner WHERE status='active' LIMIT 1");
    if (!ownerRow) { process.stderr.write('no active mission owner to attribute the proposals to\n'); process.exit(1); }
    if (!classContractDefinition(agentClass)) { process.stderr.write(`unknown agent class '${agentClass}'\n`); process.exit(2); }
    const actor = { kind: 'owner' as const, id: String(ownerRow.id) };
    const result = prepareClassContractsForClass(actor, { agentClass, limit });
    process.stdout.write(`\n  class ${result.agentClass}: considered ${result.considered}, eligible ${result.eligible}, prepared ${result.prepared}, skipped ${result.skipped.length}\n`);
    for (const skip of result.skipped.slice(0, 10)) process.stdout.write(`    ! ${skip.agentId} — ${skip.reason}\n`);
    for (const proposal of listClassContractProposals('pending', 10)) {
      process.stdout.write(`    · ${proposal.id} → ${proposal.agentId} · perms ${proposal.permissions.join('+') || 'none'} · spend ${proposal.budgetCents}c · expires ${proposal.expiresAt}\n`);
    }
    process.stdout.write(`  ${result.note}\n`);
    process.stdout.write('  approve one with: npm run fleet:readiness -- --contracts-approve=<proposalId>\n\n');
    return;
  }

  if (pilotOpportunity) {
    const { configuredGithubBountyWorkflow } = await import('../src/mission/earning/github-bounty-workflow');
    const { eligibleAgentsForClass } = await import('../src/mission/earning/agent-class-contracts');
    const ownerRow = missionDb.get<Row>("SELECT id FROM mission_owner WHERE status='active' LIMIT 1");
    if (!ownerRow) { process.stderr.write('no active mission owner to attribute the run to\n'); process.exit(1); }
    const actor = { kind: 'owner' as const, id: String(ownerRow.id) };
    const workflow = configuredGithubBountyWorkflow();
    process.stdout.write(`\n  pilot run for ${pilotOpportunity}\n`);
    const policy = await workflow.checkPolicy(actor, pilotOpportunity);
    process.stdout.write(`    policy: ai_contributions_allowed=${String(policy?.ai_contributions_allowed)} disclosure_required=${String(policy?.disclosure_required)} source=${String(policy?.policy_source ?? 'none')}\n`);
    const verdict = await workflow.recheckEligibility(actor, pilotOpportunity);
    process.stdout.write(`    claim: ${String(verdict.claim_state)}${verdict.claim_reason ? ` (${String(verdict.claim_reason)})` : ''}\n`);
    if (String(verdict.claim_state) !== 'payable') { process.stdout.write('    stopped: the bounty is not provably payable to us, so nothing was executed.\n\n'); return; }
    const agentId = eligibleAgentsForClass('bounty_execution', 1)[0] ?? null;
    if (!agentId) { process.stdout.write('    stopped: no agent currently qualifies for the sandboxed execution class (active money grant + configured execution backend required).\n\n'); return; }
    const assignment = workflow.assign(actor, { agentId, opportunityId: pilotOpportunity });
    process.stdout.write(`    assigned: ${String(assignment.id)} → ${agentId} (${String(assignment.state)})\n`);
    const job = workflow.queueExecution(actor, String(assignment.id));
    process.stdout.write(`    execution job: ${String(job.id)} (${String(job.state)})\n`);
    const executed = await workflow.executeJob(actor, String(job.id));
    process.stdout.write(`    executed: state=${String(executed.state)}${executed.blocked_reason ? ` reason=${String(executed.blocked_reason)}` : ''}\n`);
    // The durable evidence chain for a sandboxed run lives on the job row itself: the
    // archive hash, the inspection manifest, the frozen proposal and the verification
    // report. Each is printed as a hash so the operator can match it against a verifier.
    const jobRow = missionDb.get<Row>('SELECT * FROM mission_bounty_execution_jobs WHERE id=?', [String(executed.id)]);
    if (jobRow) {
      if (jobRow.archive_sha256) process.stdout.write(`      · archive sha256 ${String(jobRow.archive_sha256)}\n`);
      for (const column of ['inspection_json', 'proposal_json', 'verification_json'] as const) {
        const raw = jobRow[column] === null || jobRow[column] === undefined ? '' : String(jobRow[column]);
        if (!raw) { process.stdout.write(`      · ${column} — not written\n`); continue; }
        const hash = createHash('sha256').update(raw).digest('hex');
        process.stdout.write(`      · ${column} sha256 ${hash.slice(0, 24)}… (${Buffer.byteLength(raw, 'utf8')}B)\n`);
      }
    }
    const events = missionDb.all<Row>('SELECT state, evidence_ref FROM mission_bounty_events WHERE subject_id=? ORDER BY seq', [String(executed.id)]);
    for (const row of events.slice(0, 12)) process.stdout.write(`      · event ${String(row.state)} ${String(row.evidence_ref).slice(0, 72)}\n`);
    process.stdout.write('    submission is deliberately not attempted: it is an owner-authorized action.\n\n');
    return;
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

    process.stdout.write('\n  execution gates (config-level; probe them with --backends)\n');
    line('execution backend', summary.execution.backendConfigured ? `configured (mode ${summary.execution.sandboxMode}${summary.execution.sandboxImagePinned ? ', OCI digest pinned' : ', no OCI pin'})` : 'NONE — no pinned OCI image and no staged namespace rootfs on this host');
    line('model dispatch', `${summary.execution.modelMode} · ${summary.execution.modelDispatchable ? 'dispatchable' : `blocked: ${summary.execution.modelBlockers.join(', ') || 'unknown'}`}`);
    line('github credential', summary.execution.githubCredentialPresent ? 'present (read paths authenticated; submission still owner-authorized)' : 'absent (read-only discovery at the anonymous rate budget)');
    line('scoped contracts', `${summary.contracts.scopedActive} active · ${summary.contracts.preparedProposals} prepared and awaiting owner approval`);

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
