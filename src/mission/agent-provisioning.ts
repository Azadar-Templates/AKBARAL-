/**
 * ZA141251SA AGENT PROVISIONING
 *
 * Bulk-provisions the 4,001 mission agents from the AKBARAL! specialist
 * catalog into the mission database. Each agent gets:
 *   - A unique mission ID
 *   - Matching slug/name from the catalog
 *   - Capabilities derived from domain + specialization
 *   - Active status (ready for assignment)
 *
 * This is ONE-WAY: catalog → mission. The platform is never modified.
 * Idempotent: existing agents by slug are updated, not duplicated.
 *
 * Does NOT fabricate earnings, wallets, or opportunities.
 * Does NOT activate earning — that requires separate scheduler enablement.
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row } from './database';
import { MoneyError, type MoneyActor } from './money';
import { currentPolicy } from './policy';
import { generateAgentDefinitions, agentDefinitionCount, type AgentDefinition } from '../agents/catalog';

function deny(code: string): never { throw new MoneyError(`provisioning_${code}` as any); }

export interface ProvisioningResult {
  totalCatalog: number;
  provisioned: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

/** Map a catalog agent definition to mission agent capabilities */
function deriveCapabilities(def: AgentDefinition): string[] {
  const caps = new Set<string>();
  // Add domain-derived capabilities
  caps.add(def.categorySlug);
  // Add explicit capabilities
  for (const c of def.capabilities) caps.add(c);
  // Add tool-derived capabilities
  for (const t of def.toolPermissions) caps.add(t);
  // Add model capability hints
  for (const m of def.modelRequirements) caps.add(m);
  return [...caps].slice(0, 30); // limit to 30 capabilities per agent
}

/** Map a category slug to a mission role_key */
function deriveRoleKey(categorySlug: string): string {
  if (categorySlug.includes('strategy') || categorySlug.includes('ceo') || categorySlug.includes('startup')) return 'strategist';
  if (categorySlug.includes('engineer') || categorySlug.includes('development') || categorySlug.includes('devops') || categorySlug.includes('cloud')) return 'builder';
  if (categorySlug.includes('test') || categorySlug.includes('quality') || categorySlug.includes('compliance') || categorySlug.includes('security')) return 'validator';
  return 'specialist';
}

/** Provision all 4,001 agents from catalog into mission DB */
export function provisionAllAgents(actor: MoneyActor): ProvisioningResult {
  const policy = currentPolicy();
  if (policy.killSwitch) deny('kill_switch_engaged');

  const start = Date.now();
  const definitions = generateAgentDefinitions();
  const catalogTotal = definitions.length;

  if (catalogTotal !== agentDefinitionCount()) {
    // Safety: catalog count mismatch — do not proceed
    deny('catalog_count_mismatch');
  }

  let provisioned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches for performance
  const BATCH_SIZE = 200;

  for (let i = 0; i < definitions.length; i += BATCH_SIZE) {
    const batch = definitions.slice(i, i + BATCH_SIZE);

    db.run('BEGIN TRANSACTION');
    try {
      for (const def of batch) {
        try {
          const existing = db.get<Row>('SELECT id FROM mission_agents WHERE slug=?', [def.slug]);
          const capabilities = JSON.stringify(deriveCapabilities(def));
          const roleKey = deriveRoleKey(def.categorySlug);
          const now = nowIso();

          if (existing) {
            // Update existing agent with latest catalog data
            db.run(
              'UPDATE mission_agents SET name=?, category=?, role_key=?, capabilities=?, updated_at=? WHERE slug=?',
              [def.name, def.categorySlug, roleKey, capabilities, now, def.slug]
            );
            updated++;
          } else {
            // Insert new agent
            const id = missionId('magt');
            db.run(
              `INSERT INTO mission_agents (id, slug, name, category, role_key, depth, generation, status, mission_role, origin_platform, capabilities, created_at, updated_at)
               VALUES (?,?,?,?,'${roleKey}',0,'registry','active','worker','akbaral-registry',?,?,?)`,
              [id, def.slug, def.name, def.categorySlug, capabilities, now, now]
            );
            provisioned++;
          }
        } catch (e) {
          errors++;
          // Continue with next agent — do not abort batch
        }
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      errors += batch.length;
    }
  }

  const durationMs = Date.now() - start;

  // Audit
  appendMissionAudit({
    actorType: actor.kind as any,
    actorId: actor.id,
    action: 'agents.provisioned_bulk',
    subjectType: 'mission',
    subjectId: 'fleet',
    detail: { catalogTotal, provisioned, updated, skipped, errors, durationMs } as any,
  });

  return { totalCatalog: catalogTotal, provisioned, updated, skipped, errors, durationMs };
}

/** Provision money grants for all active agents (required before assignment) */
export function provisionAgentGrants(actor: MoneyActor, opts: {
  spendLimitCents?: number;
  delegationCents?: number;
  expiresDays?: number;
} = {}): { granted: number; skipped: number; errors: number } {
  const policy = currentPolicy();
  if (policy.killSwitch) deny('kill_switch_engaged');

  const spendLimitCents = opts.spendLimitCents ?? 10000; // $100 default per agent
  const delegationCents = opts.delegationCents ?? 0;
  const expiresDays = opts.expiresDays ?? 30;

  const agents = db.all<Row>("SELECT id FROM mission_agents WHERE status='active'");
  let granted = 0;
  let skipped = 0;
  let errors = 0;

  // Use bootstrapMoneyAgents for the standard path, or provisionMoneyAgent for individual grants
  const { provisionMoneyAgent } = require('./money') as typeof import('./money');

  for (const agent of agents) {
    const agentId = String(agent.id);
    // Check if grant already exists
    const existing = db.get<Row>('SELECT agent_id FROM mission_money_grants WHERE agent_id=? AND status=?', [agentId, 'active']);
    if (existing) {
      skipped++;
      continue;
    }
    try {
      provisionMoneyAgent(agentId, actor.id);
      granted++;
    } catch (e) {
      errors++;
    }
  }

  appendMissionAudit({
    actorType: actor.kind as any,
    actorId: actor.id,
    action: 'agents.grants_provisioned',
    subjectType: 'mission',
    subjectId: 'fleet',
    detail: { granted, skipped, errors, spendLimitCents, delegationCents, expiresDays } as any,
  });

  return { granted, skipped, errors };
}

/** Get provisioning status summary */
export function provisioningStatus(): {
  catalogTotal: number;
  persistedAgents: number;
  activeAgents: number;
  agentsWithGrants: number;
  agentsWithoutGrants: number;
} {
  const catalogTotal = agentDefinitionCount();
  const persistedAgents = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0);
  const activeAgents = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_agents WHERE status='active'")?.c ?? 0);
  const agentsWithGrants = Number(db.get<Row>("SELECT COUNT(DISTINCT agent_id) as c FROM mission_money_grants WHERE status='active'")?.c ?? 0);
  const agentsWithoutGrants = activeAgents - agentsWithGrants;

  return { catalogTotal, persistedAgents, activeAgents, agentsWithGrants, agentsWithoutGrants };
}
