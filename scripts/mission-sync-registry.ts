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
import { applyMissionMigrations, missionDb, nowIso, appendMissionAudit, type Row } from '../src/mission/database';
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
  ensurePolicy(currentPolicy().currency);
  applyMissionMigrations();

  const skip = process.argv.includes('--skip-platform');
  const agents = skip ? [] : await readPlatformRegistry();

  if (agents.length === 0) {
    process.stdout.write(
      skip
        ? 'mission:sync-registry — platform read skipped (--skip-platform); mission agents untouched.\n'
        : 'mission:sync-registry — the platform registry returned no agents. Nothing was invented or written.\n',
    );
    process.exit(0);
  }

  const policy = currentPolicy();
  let created = 0;
  let updated = 0;
  missionDb.transaction(() => {
    for (const agent of agents) {
      const existing = missionDb.get<Row>('SELECT id FROM mission_agents WHERE slug = ?', [agent.slug]);
      if (existing) {
        missionDb.run(
          `UPDATE mission_agents SET name = ?, category = ?, capabilities = ?, origin_platform = 'akbaral-registry', updated_at = ? WHERE id = ?`,
          [agent.name, agent.category, JSON.stringify(agent.capabilities ?? []), nowIso(), String(existing.id)],
        );
        updated += 1;
        continue;
      }
      missionDb.run(
        `INSERT INTO mission_agents (id, slug, name, category, role_key, parent_id, depth, generation, status, mission_role, origin_platform, capabilities)
         VALUES (?, ?, ?, ?, 'specialist', NULL, 0, 'registry', 'active', 'worker', 'akbaral-registry', ?)`,
        [`agt_reg_${agent.slug.slice(0, 32)}`, agent.slug, agent.name.slice(0, 200), agent.category, JSON.stringify(agent.capabilities ?? [])],
      );
      created += 1;
    }
  });

  appendMissionAudit({
    actorType: 'system',
    action: 'registry.synced',
    subjectType: 'mission',
    subjectId: 'registry',
    detail: { created, updated, total: agents.length, source: 'akbaral-registry (read-only export)' },
  });

  // The registry ceiling in policy is checked, not silently exceeded.
  const totalRow = missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_agents');
  const total = Number(totalRow?.count ?? 0);
  process.stdout.write(
    `mission:sync-registry — ${created} created, ${updated} updated, ${total} mission agents total ` +
      `(policy max ${policy.maxAgents}).\n`,
  );
  if (total > policy.maxAgents) {
    process.stdout.write(
      `  note: the registry exceeds the configured agent ceiling (${policy.maxAgents}). Raise it deliberately via ` +
        `PATCH /api/policy { "maxAgents": n } — nothing was removed.\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`mission:sync-registry failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
