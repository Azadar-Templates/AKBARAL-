/**
 * ZA141251SA registry sync — `npm run mission:sync-registry`
 *
 * Copies the AKBARAL! specialist registry — identities AND the tool grants attached to
 * them — into the mission database, so the mission can address the same fleet without a
 * live join into the platform schema.
 *
 * Why this file was rewritten. It used to be able to do nothing and look like success:
 *   · it printed nothing about which database it had read, so "the platform registry is
 *     empty in the file you pointed me at" and "you pointed me at the wrong file" were
 *     indistinguishable from a healthy run;
 *   · a zero-agent read exited 0 with one line on stdout and no non-zero code, so it could
 *     not be caught by anything but a human reading the log;
 *   · the platform read is filtered on `owner_id IS NULL` (`src/agents/registry.ts`), and
 *     when that filter matched nothing the run still exited 0;
 *   · nothing was printed between the first line and the last, so a run that was killed
 *     (or that died in the giant single transaction) left no trace of how far it got;
 *   · and `process.stdout.write` followed by `process.exit()` loses a buffered stdout write
 *     when stdout is a pipe — the summary could simply vanish, which is what "no output, no
 *     error, no work" looks like from the outside.
 * Every one of those is closed here: both targets and their counts are reported before any
 * write, every report goes to the file descriptor synchronously, the empty and filtered-out
 * cases exit non-zero with the reason, and the run says what it did per batch.
 *
 * Properties that keep the two systems separate (unchanged, and asserted by tests):
 *   · ONE-WAY export: reads the platform registry, writes only to the mission database.
 *     The platform is never written to — the file is verified byte-identical before/after.
 *   · NO LIVE JOIN at runtime for mission code: this command is the only bridge and it is
 *     run explicitly.
 *   · Metadata only: slug, name, category, capabilities, and (tool key, name, kind,
 *     permission). No user data, no credentials, no billing rows, and the platform's
 *     `agent_tools.config` payload is deliberately not copied — it is counted and reported.
 *   · Idempotent: existing rows are compared first and left untouched when they already
 *     match; a second run writes 0 rows and says "already in sync".
 *   · Imports in batches, one transaction per batch: a failure mid-run rolls that batch
 *     back whole, so no agent is ever half-written, and the run stops non-zero naming the
 *     batch it stopped at.
 */
import fs from 'node:fs';
import { applyMissionMigrations, missionDb } from '../src/mission/database';
import { currentPolicy, ensurePolicy } from '../src/mission/policy';
import { syncMissionRegistry, type RegistryAgentMetadata, type RegistryToolGrantMetadata } from '../src/mission/registry-sync';
import { env } from '../src/config/env';
import { resolveDatabasePath } from '../src/db/path';

const TAG = 'mission:sync-registry';
const BATCH_AGENTS = 500;
const PAGE = 200;

/**
 * Reports go through the file descriptor, not a buffered stream: a write that is still in
 * the libuv queue when the process exits is lost on a pipe, and a lost report is exactly
 * the failure mode this command had.
 */
let stdoutBroken = false;
function say(line: string): void {
  const text = line.endsWith('\n') ? line : `${line}\n`;
  try {
    if (stdoutBroken) fs.writeSync(2, text);
    else fs.writeSync(1, text);
  } catch (error) {
    // A reader that hangs up (a closed pipe, `| head -1`) is not a failed sync, and it
    // must never turn into one: from here the same reports go to stderr so the run is
    // still heard. Only a broken stdout is tolerated; a broken database never is.
    if ((error as NodeJS.ErrnoException).code !== 'EPIPE') throw error;
    if (!stdoutBroken) {
      stdoutBroken = true;
      try {
        fs.writeSync(2, `${TAG} — stdout was closed by the reader; the remaining reports go to stderr.\n`);
      } catch {
        /* both channels gone: the exit code is what is left, and it stays meaningful */
      }
    }
  }
}
function fail(reason: string): never {
  fs.writeSync(2, `${TAG} FAILED — ${reason}\n`);
  try {
    missionDb.close();
  } catch {
    /* the connection may already be gone; the reason above is what matters */
  }
  process.exit(1);
}

interface PlatformReads {
  discoverAgents: (filter: { limit: number; offset: number; platformOnly?: boolean }) => { agents: unknown[]; total: number };
  discoverAgentToolGrants: (filter: { limit: number; offset: number }) => {
    grants: Array<{ agentSlug: string; toolKey: string; toolName: string; kind: string; permission: string; hasConfig: boolean }>;
    total: number;
  };
  registryInventory: () => { agents: number; platformAgents: number; toolGrants: number; platformToolGrants: number };
}

async function platformModule(): Promise<PlatformReads> {
  // Imported lazily so the mission tooling still runs (init/serve/tests) when a platform
  // DATABASE_URL is not configured — and so a packaging problem in this tree is reported
  // here, by name, instead of surfacing as a process that printed nothing and stopped.
  try {
    const mod = (await import('../src/agents/registry')) as unknown as PlatformReads;
    for (const name of ['discoverAgents', 'discoverAgentToolGrants', 'registryInventory'] as const) {
      if (typeof mod[name] !== 'function') throw new Error(`${name} is not exported by src/agents/registry`);
    }
    return mod;
  } catch (error) {
    fail(`the platform registry could not be loaded from this tree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const skipPlatform = process.argv.includes('--skip-platform');

  // The targets, stated before anything is written, so a run can be interpreted from its
  // first three lines alone. No URL is ever printed whole for the mission side: the path
  // form the mission driver displays is already credential-free.
  applyMissionMigrations();
  ensurePolicy(currentPolicy().currency);
  say(
    `${TAG} — mission ${missionDb.engineName()} ${missionDb.path()}; ` +
      `ledger ${missionDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM mission_migrations')?.n ?? 0} migrations; ` +
      `batch ${BATCH_AGENTS} agents per transaction`,
  );

  const platformUrl = env.databaseUrl;
  const platformPath = resolveDatabasePath(platformUrl);
  const platformIsFile = !platformUrl.startsWith('postgres');
  if (platformIsFile && !fs.existsSync(platformPath)) {
    fail(
      `the platform database is not there: ${platformUrl} resolves to ${platformPath} and that file does not exist ` +
        `(DATABASE_URL is ${process.env.DATABASE_URL ? 'set' : 'not set'} in this process; DATA_DIR is ` +
        `${process.env.DATA_DIR ? process.env.DATA_DIR : 'not set, so the default applies'}). ` +
        'The sync never creates or selects an alternate platform database.',
    );
  }
  say(`${TAG} — platform ${platformIsFile ? 'sqlite' : 'postgres'} ${platformPath}`);

  const platform = await platformModule();
  let inventory: ReturnType<PlatformReads['registryInventory']>;
  try {
    inventory = platform.registryInventory();
  } catch (error) {
    fail(`the platform database could not be read (${error instanceof Error ? error.message : String(error)}).`);
  }
  say(
    `${TAG} — platform counts: agents ${inventory.agents}, platform-owned ${inventory.platformAgents}, ` +
      `agent_tools ${inventory.toolGrants}, attached to platform-owned agents ${inventory.platformToolGrants}`,
  );

  if (skipPlatform) {
    say(
      `${TAG} — platform read SKIPPED on purpose (--skip-platform); ${missionDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM mission_agents')?.n ?? 0} ` +
        'mission identities left exactly as they are. This is not a sync and is not reported as one.',
    );
    missionDb.close();
    return;
  }

  // The three ways this command used to do nothing and look fine. Each one now has a
  // different, explicit outcome.
  if (inventory.agents === 0) {
    say(`${TAG} — nothing to sync: the platform registry at ${platformPath} holds 0 agents. No mission row was written or removed.`);
    missionDb.close();
    return;
  }
  if (inventory.platformAgents === 0) {
    fail(
      `the platform registry holds ${inventory.agents} agents but 0 of them are platform-owned, and the sync reads ` +
        'platform-owned agents only (`owner_id IS NULL`, see discoverAgents in src/agents/registry.ts). ' +
        'This is the filter, not the data: no mission identity was created.',
    );
  }

  const collected: RegistryAgentMetadata[] = [];
  try {
    for (let offset = 0; ; offset += PAGE) {
      const page = platform.discoverAgents({ limit: PAGE, offset, platformOnly: true });
      if (page.agents.length === 0) break;
      for (const raw of page.agents) {
        const agent = raw as { slug: string; name: string; category: string | null; capabilities?: string[] };
        collected.push({
          slug: agent.slug,
          name: agent.name,
          category: agent.category ?? null,
          capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
        });
      }
      if (collected.length >= page.total) break;
      if (collected.length % 1000 === 0) say(`${TAG} — read ${collected.length} platform agents…`);
    }
  } catch (error) {
    fail(`reading the platform registry failed at ${collected.length} agents collected: ${error instanceof Error ? error.message : String(error)}`);
  }

  const grants: RegistryToolGrantMetadata[] = [];
  let configSkippedOnRead = 0;
  try {
    for (let offset = 0; ; offset += PAGE) {
      const page = platform.discoverAgentToolGrants({ limit: PAGE, offset });
      if (page.grants.length === 0) break;
      for (const grant of page.grants) {
        if (grant.hasConfig) configSkippedOnRead++;
        grants.push({
          agentSlug: grant.agentSlug,
          toolKey: grant.toolKey,
          toolName: grant.toolName,
          kind: grant.kind,
          permission: grant.permission,
          configSkipped: grant.hasConfig,
        });
      }
      if (grants.length >= page.total) break;
    }
  } catch (error) {
    fail(`reading the platform tool grants failed at ${grants.length} grants collected: ${error instanceof Error ? error.message : String(error)}`);
  }
  say(
    `${TAG} — collected ${collected.length} identities and ${grants.length} tool grants ` +
      `(${configSkippedOnRead} of them carry a platform config payload, not copied by design)`,
  );

  if (collected.length !== inventory.platformAgents) {
    fail(
      `the paged read collected ${collected.length} agents while the platform reports ${inventory.platformAgents} ` +
        'platform-owned ones. A partial read is not synced: an incomplete export would look like a fleet that lost agents.',
    );
  }
  if (grants.length !== inventory.platformToolGrants) {
    fail(
      `the paged read collected ${grants.length} tool grants while the platform reports ${inventory.platformToolGrants} ` +
        'attached to platform-owned agents. A partial grant read is not synced either: a fleet missing ten capabilities ' +
        'looks exactly like a fleet that has none of them, from the mission side.',
    );
  }

  // Batched on purpose: one transaction per batch, so a failure mid-run cannot leave a
  // half-written agent, and so the log says how far the run got before it stopped.
  const totals = {
    created: 0,
    updated: 0,
    unchanged: 0,
    toolGrantsCreated: 0,
    toolGrantsUpdated: 0,
    toolGrantsUnchanged: 0,
    configPayloadsSkipped: 0,
    orphanGrants: 0,
    total: 0,
  };
  const skipReasons = new Map<string, number>();
  let batch = 0;
  const batches = Math.ceil(collected.length / BATCH_AGENTS);
  for (let start = 0; start < collected.length; start += BATCH_AGENTS) {
    batch += 1;
    const slice = collected.slice(start, start + BATCH_AGENTS);
    const slugs = new Set(slice.map((agent) => agent.slug));
    const sliceGrants = grants.filter((grant) => slugs.has(grant.agentSlug));
    let result;
    try {
      result = syncMissionRegistry(slice, sliceGrants);
    } catch (error) {
      fail(
        `batch ${batch} of ${batches} (agents ${start + 1}-${start + slice.length}) failed and was rolled back whole: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `${totals.created + totals.updated} row(s) written by the ${batch - 1} earlier batch(es); ` +
          'nothing from the failing batch is in the database. Re-run the same command to resume — it is idempotent.',
      );
    }
    totals.created += result.created;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
    totals.toolGrantsCreated += result.toolGrantsCreated;
    totals.toolGrantsUpdated += result.toolGrantsUpdated;
    totals.toolGrantsUnchanged += result.toolGrantsUnchanged;
    totals.configPayloadsSkipped += result.configPayloadsSkipped;
    totals.orphanGrants += result.orphanGrants;
    totals.total = result.total;
    for (const entry of result.skipped) skipReasons.set(entry.reason, (skipReasons.get(entry.reason) ?? 0) + entry.count);
    say(
      `${TAG} — batch ${batch}/${batches}: ${result.created} created, ${result.updated} updated, ` +
        `${result.unchanged} already matching, ${result.toolGrantsCreated + result.toolGrantsUpdated} grant rows written`,
    );
  }

  const written = totals.created + totals.updated + totals.toolGrantsCreated + totals.toolGrantsUpdated;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  say(
    `${TAG} — ${written === 0 ? 'ALREADY IN SYNC: ' : ''}engine ${missionDb.engineName()}, target ${missionDb.path()}, ` +
      `source ${inventory.platformAgents} identities / ${inventory.platformToolGrants} grants, ` +
      `written ${written} (agents ${totals.created} created, ${totals.updated} updated, ${totals.unchanged} unchanged; ` +
      `grants ${totals.toolGrantsCreated} created, ${totals.toolGrantsUpdated} updated, ${totals.toolGrantsUnchanged} unchanged), ` +
      `mission identities now ${totals.total}, in ${seconds}s`,
  );
  if (skipReasons.size > 0) {
    for (const [reason, count] of skipReasons) say(`${TAG} — skipped ${count}: ${reason}`);
  }
  say(
    `${TAG} — wrote nothing to the platform database; no ledger entry, no balance, no payout slot, no approval and no ` +
      'tool approval was created or changed (mission_tools rows untouched, mission ledger rows unchanged).',
  );
  missionDb.close();
}

process.on('unhandledRejection', (reason) => {
  // A rejected promise that nobody awaits must not end the run quietly.
  fail(`unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
