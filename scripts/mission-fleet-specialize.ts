/**
 * ZA141251SA specialist fleet builder — `npm run mission:fleet:specialize`
 *
 * Turns the fleet's platform list from a wish-list into a verified catalog, then assigns agents
 * to venues one-to-one, materializes each agent's specialist profile from the venue's own rules,
 * grades it with the deterministic evaluation suite, and records where every registered agent
 * actually stands. Nothing here pretends the fleet is bigger than the number of real venues: agents
 * with no distinct verified platform are reported as `UNASSIGNED_PLATFORM` with the reason.
 *
 * Modes (any combination; writes happen only in the modes named):
 *   --apply-catalog          attach today's verified evidence record to each named venue, and let
 *                            the lifecycle advance only as far as that evidence supports
 *   --priority               assign the next unassigned production agent to every venue whose
 *                            evidence says it is open today, in the owner's priority order
 *   --assign=<platformId>    one assignment; --agent=<slug|id> to target, --group=<gmail-n> to
 *                            override the owner's grouping label
 *   --certify[=<n>]          run each assigned agent's suite in deterministic mode and advance the
 *                            ones that pass the safety-critical gates
 *   --rank=<agentRef|all>    build the priority queue for one specialist (or every assigned one)
 *   --state=<ref>:<STATE>    owner-only ladder transition, with the gate re-checked
 *   --release=<agentRef>     owner-only; requires --reason
 *   --refresh                recompute the readiness state of every registered agent from rows
 *   --report                 the owner-facing summary (default when no mode is given)
 *
 * `--json` prints machine-readable output. There is no mode that submits work, opens an account,
 * handles a credential, or records revenue: those stay owner actions on the existing gates.
 *
 * Env: ZA141251SA_DATABASE_URL / DATA_DIR (mission DB), ZA141251SA_SESSION_SECRET for encryption
 * of anything that stores a secret (this script stores none).
 */
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import type { MoneyActor } from '../src/mission/money';
import { GMAIL_GROUPS, applyPlatformCatalog, catalogSummary, platformRecordFor } from '../src/mission/earning/platform-catalog';
import {
  certifyAgents, evaluateGates, fleetReport, groupingGaps, rankOpportunityQueue,
  refreshFleetStates, releaseAssignment, setSpecialistState, specializeAgent,
  type FleetState, type SpecialistState,
} from '../src/mission/earning/specialist-fleet';

const argv = process.argv.slice(2);
const has = (flag: string): boolean => argv.includes(`--${flag}`);
const option = (name: string): string | null => {
  const hit = argv.find(argument => argument.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const asJson = has('json');
// No implicit cap on a readiness refresh: a partial scan that looks like a full one is the
// easiest way to under-report a fleet.
const limit = Number(option('limit') ?? 100_000);

function out(text = ''): void { process.stdout.write(`${text}
`); }
function field(label: string, value: string): void { out(`  ${label.padEnd(34)} ${value}`); }

function fail(message: string): never {
  if (asJson) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  else process.stderr.write(`${message}\n`);
  process.exit(1);
}

function ownerActor(): MoneyActor {
  const row = missionDb.get<Row>("SELECT id FROM mission_owner WHERE status='active' LIMIT 1");
  if (!row) fail('no active mission owner: the fleet refuses to write catalog or assignment rows without an owner to attribute them to');
  return { kind: 'owner', id: String(row!.id) };
}

/** Slug first, then id. Never a fuzzy match: a wrong agent gets the wrong platform. */
function resolveAgent(reference: string): { id: string; slug: string } {
  const row = missionDb.get<Row>('SELECT id, slug FROM mission_agents WHERE slug=? OR id=? LIMIT 1', [reference, reference]);
  if (!row) fail(`no mission agent matches '${reference}' (exact slug or id only)`);
  return { id: String(row!.id), slug: String(row!.slug) };
}

function nextUnassignedAgent(): { id: string; slug: string } | null {
  const row = missionDb.get<Row>(
    `SELECT a.id, a.slug FROM mission_agents a
      WHERE (a.origin_platform IS NULL OR a.origin_platform NOT IN ('fixture','test','test_fixture'))
        AND a.status='active'
        AND NOT EXISTS (SELECT 1 FROM mission_agent_platform_assignments p WHERE p.agent_id=a.id AND p.slot_type='primary' AND p.status='active')
      ORDER BY a.depth ASC, a.id ASC LIMIT 1`,
  );
  return row ? { id: String(row.id), slug: String(row.slug) } : null;
}

function main(): void {
  applyMissionMigrations();
  const actor = ownerActor();
  const modes = ['apply-catalog', 'priority', 'certify', 'refresh', 'report'].filter(has).length
    + (option('assign') ? 1 : 0) + (option('rank') ? 1 : 0) + (option('state') ? 1 : 0) + (option('release') ? 1 : 0);
  if (!modes) {
    // No mode at all means the owner asked for the picture, not a mutation.
    argv.push('--report');
  }

  const report: Record<string, unknown> = { ok: true, generatedAt: new Date().toISOString() };

  if (has('apply-catalog') || has('priority') || option('assign')) {
    const applied = applyPlatformCatalog(actor);
    report.catalog = applied;
    out('verified platform catalog');
    field('platforms observed', String(applied.observed));
    field('registry rows created', String(applied.created));
    field('evidence records written', String(applied.evidenced));
    field('lifecycle advanced', String(applied.advanced));
    field('restricted from evidence', String(applied.restricted));
    out('');
  }

  if (has('priority') || option('assign')) {
    const summary = catalogSummary();
    out('venue status today');
    for (const row of summary.rows) {
      const mark = row.assignable ? 'assignable' : `not assignable (${row.blockingReasons.join(',')})`;
      out(`  ${row.platformId.padEnd(24)} ${row.verdict.padEnd(11)} ${mark}`);
      out(`  ${''.padEnd(24)} ${row.verdictReason.slice(0, 110)}`);
    }
    out('');

    const single = option('assign');
    const targets = single
      ? [{ platformId: single, agent: option('agent') }]
      : summary.rows.filter(row => row.assignable).map(row => ({ platformId: row.platformId, agent: null as string | null }));
    // A venue keeps the specialist it already has: `--priority` refreshed an existing pairing
    // rather than demanding a new agent for a platform that is taken.
    const holderOf = (platformId: string): string | null => {
      const row = missionDb.get<Row>("SELECT agent_id AS id FROM mission_agent_platform_assignments WHERE platform_id=? AND slot_type='primary' AND status='active'", [platformId]);
      return row ? String(row.id) : null;
    };

    const groupOverride = option('group');
    if (groupOverride && !(GMAIL_GROUPS as readonly string[]).includes(groupOverride)) fail(`unknown account grouping '${groupOverride}'`);

    const assigned: unknown[] = [];
    const refused: unknown[] = [];
    for (const target of targets) {
      if (!platformRecordFor(target.platformId)) { refused.push({ platform: target.platformId, error: 'not_in_catalog' }); continue; }
      const holder = holderOf(target.platformId);
      const agent = target.agent ? resolveAgent(target.agent) : holder ? { id: holder, slug: holder } : nextUnassignedAgent();
      if (!agent) { refused.push({ platform: target.platformId, error: 'no_unassigned_production_agent' }); continue; }
      try {
        const result = specializeAgent({
          actor, agentId: agent.id, platformId: target.platformId,
          ...(groupOverride ? { gmailGroup: groupOverride as (typeof GMAIL_GROUPS)[number] } : {}),
        });
        assigned.push({ agent: agent.slug, ...result.assignment, state: result.state, stateReason: result.stateReason, profileDigest: result.profileDigest.slice(0, 16) });
      } catch (error) {
        refused.push({ agent: agent.slug, platform: target.platformId, error: String((error as Error).message).slice(0, 220) });
      }
    }
    out('assignments');
    for (const entry of assigned) out(`  + ${JSON.stringify(entry)}`);
    for (const entry of refused) out(`  ! ${JSON.stringify(entry)}`);
    out('');
    report.assignments = { assigned, refused };
  }

  if (has('certify')) {
    const raw = option('certify');
    // `--certify` alone means "every assigned agent"; `--certify=12` caps the pass;
    // `--certify=<slug>,<slug>` names them. A bare flag must never mean zero.
    const cap = raw && /^\d+$/.test(raw) ? Number(raw) : 500;
    const ids = raw && !/^\d+$/.test(raw) ? raw.split(',').map(entry => resolveAgent(entry.trim()).id) : undefined;
    const result = certifyAgents({ actor, ...(ids ? { agentIds: ids } : {}), limit: cap });
    report.certification = result;
    out('skill certification (deterministic suites against the real engines)');
    field('agents attempted', String(result.attempted));
    field('reached SKILLS_VERIFIED', String(result.passed));
    field('refused', String(result.failed.length));
    for (const entry of result.failed.slice(0, 12)) out(`    - ${entry.agentId.slice(0, 12)} score=${entry.score} ${entry.blockers.join(' | ').slice(0, 200)}`);
    out('');
  }

  const rankTarget = option('rank');
  if (rankTarget) {
    const assignedIds = (missionDb.all<Row>("SELECT agent_id AS id FROM mission_agent_platform_assignments WHERE status='active' ORDER BY agent_id") ?? []).map(row => String(row.id));
    const ids = rankTarget === 'all' ? assignedIds : [resolveAgent(rankTarget).id];
    const queues: unknown[] = [];
    for (const agentId of ids) {
      try {
        const queue = rankOpportunityQueue({ actor, agentId, limit: 10 });
        queues.push({ agent: agentId, ranked: queue.written, registryRows: queue.registryRows, ...(queue.note ? { note: queue.note } : {}), top: queue.rows.slice(0, 3) });
      } catch (error) {
        queues.push({ agent: agentId, error: String((error as Error).message).slice(0, 200) });
      }
    }
    report.queues = queues;
    out('priority queues');
    for (const entry of queues) out(`  ${JSON.stringify(entry)}`);
    out('');
  }

  const stateTarget = option('state');
  if (stateTarget) {
    const [ref, ...rest] = stateTarget.split(':');
    const to = rest.join(':') as FleetState | SpecialistState;
    if (!ref || !to) fail('use --state=<agentRef>:<STATE>');
    const agent = resolveAgent(ref);
    try {
      const result = setSpecialistState({ actor, agentId: agent.id, to: to as SpecialistState, reason: `owner transition via mission:fleet:specialize` });
      report.state = { agent: agent.slug, ...result, gates: evaluateGates(agent.id, result.to as SpecialistState) };
      out(`state ${agent.slug}: ${result.from} -> ${result.to}${result.enforced ? '' : ' (already there)'}`);
    } catch (error) {
      fail(`state transition refused: ${String((error as Error).message)}`);
    }
  }

  const releaseTarget = option('release');
  if (releaseTarget) {
    const reason = option('reason');
    if (!reason) fail('--release needs --reason');
    const agent = resolveAgent(releaseTarget);
    report.released = releaseAssignment({ actor, agentId: agent.id, reason });
    out(`released ${agent.slug}: ${JSON.stringify(report.released)}`);
  }

  if (has('refresh') || has('report')) {
    const refreshed = has('refresh') ? refreshFleetStates(actor, { limit }) : null;
    if (refreshed) report.refresh = refreshed;
    const summary = fleetReport();
    report.report = summary;
    out('');
    report.gaps = groupingGaps();
    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
      return;
    }
    out('fleet');
    field('registered agents', `${summary.agents.total} (readiness recorded for ${summary.agents.withRecordedState})`);
    field('with a verified primary platform', String(summary.agents.assigned));
    field('unassigned (recorded, not invented)', String(summary.agents.unassigned));
    field('venues in catalog (assignable)', `${summary.platforms.catalog} (${summary.platforms.assignable})`);
    field('verdicts', Object.entries(summary.platforms.byVerdict).map(([key, value]) => `${key}=${value}`).join(' '));
    field('venue adapters configured', `${summary.adapters.configured} of ${summary.adapters.total} assigned venues (${Object.entries(summary.adapters.statuses).map(([key, value]) => `${key}=${value}`).join(' ') || 'none'}; none created here)`);
    field('specialties', Object.entries(summary.agents.bySpecialty).map(([key, value]) => `${key}=${value}`).join(' '));
    out('');
    out('readiness states');
    for (const [state, count] of Object.entries(summary.states).sort((a, b) => b[1] - a[1])) field(state, String(count));
    out('');
    out('blockers');
    for (const [code, count] of Object.entries(summary.blockers).sort((a, b) => b[1] - a[1]).slice(0, 12)) field(code, String(count));
    out('');
    out('first genuinely executable opportunity');
    field('candidate', summary.firstExecutable ? JSON.stringify(summary.firstExecutable) : 'none — no agent is EXECUTION_READY with an unblocked ranked opportunity');
    out('');
    out('owner actions outstanding');
    if (!summary.ownerActions.length) out('  none recorded');
    for (const action of summary.ownerActions.slice(0, 10)) out(`  ${String(action.agents).padStart(5)} agent(s) [${action.platforms.join(',') || 'fleet'}] ${action.action}`);
    out('');
    field('revenue (ledger, settlement-backed)', `${summary.revenue.ledgerRevenueCents} cents across ${summary.revenue.settledProofs} verified settlement proof(s)`);
    out('');
    out('  Assignments and profiles are real rows; production autonomy was not enabled and nothing was');
    out('  submitted outward. Advertised venue rewards are never counted as revenue here.');
    out();
  }
}

function run(): void {
  try {
    main();
    if (asJson) return;
    out('  Every state above is a fact about rows: an agent is only as ready as the gate that let it through.');
  } catch (error) {
    fail(String((error as Error).message ?? error));
  }
}

void run();
