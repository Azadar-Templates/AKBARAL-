import { db, findUserByEmail, createUser, findAgentBySlug } from './index';
import { syncAgentRegistry, countAgentRegistry } from '../agents/registry';
import { syncModelCatalog } from '../models';
import { ensureBootstrapPlans, setFeatureFlag } from './platform-repositories';

/**
 * Development seed data.
 *
 * Seeds:
 *   - Pricing plans (free / pro / enterprise).
 *   - Model/provider/tool catalog.
 *   - Full Agent Registry (4,000+ machine-generated but genuinely
 *     differentiated specialist agents).
 *   - Service account + admin account.
 *   - Feature flags.
 *   - Web Research Agent #001 (kept from Phase 1).
 *
 * Idempotent — running `npm run db:seed` multiple times is safe.
 * No secrets are seeded.
 */
function main(): void {
  try {
    ensureBootstrapPlans();

    let serviceUser = findUserByEmail('web-research@akbaral.ai');
    if (!serviceUser) {
      serviceUser = createUser({
        email: 'web-research@akbaral.ai',
        name: 'AKBARAL Platform Service',
        role: 'service',
        status: 'active',
      });
    }

    let adminUser = findUserByEmail('admin@akbaral.ai');
    if (!adminUser) {
      adminUser = createUser({
        email: 'admin@akbaral.ai',
        name: 'AKBARAL Admin',
        role: 'admin',
        status: 'active',
      });
    }

    syncModelCatalog();

    const registry = syncAgentRegistry();
    const totalAgents = countAgentRegistry();

    setFeatureFlag({ key: 'agent_world', value: 'true', description: 'Agent discovery and marketplace enabled', enabled: true });
    setFeatureFlag({ key: 'agent_factory', value: 'true', description: 'Custom agent creation enabled', enabled: true });
    setFeatureFlag({ key: 'custom_credits', value: 'true', description: 'Custom credit purchase enabled', enabled: true });
    setFeatureFlag({ key: 'workspaces', value: 'true', description: 'Project workspaces enabled', enabled: true });

    console.log(`[seed] plans                       -> free / pro / enterprise`);
    console.log(`[seed] model catalog               -> synced`);
    console.log(`[seed] agent registry              -> ${registry.total} definitions, ${registry.created} versions inserted (db total ${totalAgents})`);
    console.log(`[seed] service user                -> web-research@akbaral.ai (${serviceUser.id})`);
    console.log(`[seed] admin user                  -> admin@akbaral.ai (${adminUser.id})`);
    console.log(`[seed] feature flags               -> agent world / factory / custom credits / workspaces`);

    const agent001 = findAgentBySlug('web-research-001');
    if (agent001) {
      console.log(`[seed] agent #001                  -> ${agent001.slug} (${agent001.id})`);
    }
  } finally {
    db.close();
  }
}

main();
