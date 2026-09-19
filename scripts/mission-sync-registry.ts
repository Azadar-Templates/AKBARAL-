import { syncMissionRegistry } from '../src/mission/registry-sync';
/**
 * ZA141251SA registry sync — `npm run mission:sync-registry`
 *
 * Copies the AKBARAL! specialist registry into the mission database so the
 * mission can address the same 4,001+ agents.
 *
 * Properties that keep the two systems separate:
 *   · ONE-WAY export: reads the platform registry, writes only to the mission
 *     database. The platform is never written to.
 *   · NO LIVE JOIN: the mission never queries platform customer data at
 *     runtime; this command is the only bridge and it is run explicitly.
 *   · Metadata only: slug, name, category, specialisation, capabilities. No
 *     user data, no credentials, no billing rows.
 *   · Idempotent: existing slugs are updated in place, never duplicated.
 */
import { applyMissionMigrations, missionDb } from '../src/mission/database';
import { currentPolicy, ensurePolicy } from '../src/mission/policy';

interface PlatformAgent {
  slug: string;
  name: string;
  category: string | null;
  specialization?: string;
  capabilities?: string[];
}

async function readPlatformRegistry(): Promise<PlatformAgent[]> {
  // Imported lazily so the mission tooling still runs (init/serve/tests) when a
  // platform DATABASE_URL is not configured.
  const { discoverAgents } = await import('../src/agents/registry');
  const collected: PlatformAgent[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const page = discoverAgents({ limit: pageSize, offset, platformOnly: true });
    if (page.agents.length === 0) break;
    for (const agent of page.agents) {
      collected.push({
        slug: agent.slug,
        name: agent.name,
        category: agent.category ?? null,
        specialization: agent.specialization,
        capabilities: agent.capabilities,
      });
    }
    if (collected.length >= page.total) break;
  }
  return collected;
}

async function main(): Promise<void> {
  applyMissionMigrations();
  ensurePolicy(currentPolicy().currency);

  const skip = process.argv.includes('--skip-platform');
  const agents = skip ? [] : await readPlatformRegistry();

  if (agents.length === 0) {
    process.stdout.write(
      skip
        ? 'mission:sync-registry — platform read skipped (--skip-platform); mission agents untouched.\n'
        : 'mission:sync-registry — the platform registry returned no agents. No registry identities were imported.\n',
    );
    missionDb.close();
    return;
  }

  const result=syncMissionRegistry(agents);
  process.stdout.write(`mission:sync-registry — ${result.created} created, ${result.updated} updated, ${result.total} mission identities; zero opening cash, no invented opportunities.\n`);
  missionDb.close();

}

main().catch((error) => {
  process.stderr.write(`mission:sync-registry failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
