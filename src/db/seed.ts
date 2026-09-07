import { db, findUserByEmail, createUser, createAgentCategory, findAgentBySlug, createAgent } from './index';

/**
 * Development seed data.
 *
 * Adds only the foundational rows needed to run the platform locally:
 *   - The service account that owns built-in agents.
 *   - The "Web Research" agent category.
 *   - Agent #001 (Web Research Agent), matching the planned implementation order.
 *
 * It is idempotent — running `npm run db:seed` multiple times is safe.
 * No secrets are seeded.
 */
function main(): void {
  try {
    let serviceUser = findUserByEmail('web-research@akbaral.ai');
    if (!serviceUser) {
      serviceUser = createUser({
        email: 'web-research@akbaral.ai',
        name: 'AKBARAL Platform Service',
        role: 'service',
        status: 'active',
      });
    }

    let categoryRow = db.get<{ id: string }>(
      'SELECT id FROM agent_categories WHERE slug = ?',
      ['web-research'],
    );
    if (!categoryRow) {
      const created = createAgentCategory({
        name: 'Web Research',
        slug: 'web-research',
        description: 'Research, retrieve, summarize, and verify web information.',
      });
      categoryRow = created;
    }

    let agent = findAgentBySlug('web-research-001');
    if (!agent) {
      agent = createAgent({
        name: 'Web Research Agent',
        slug: 'web-research-001',
        description:
          'Agent #001 — searches the web, retrieves sources, extracts facts and verifies results.',
        version: '1.0.0',
        categoryId: categoryRow.id,
        ownerId: serviceUser.id,
        status: 'active',
        config: {
          capabilities: ['web_search', 'page_fetch', 'source_extraction', 'verification'],
          limits: {
            maxSources: 10,
            timeoutSeconds: 60,
          },
        },
      });
    }

    console.log(`[seed] service user        -> web-research@akbaral.ai (${serviceUser.id})`);
    console.log(`[seed] agent category      -> web-research (${categoryRow.id})`);
    console.log(`[seed] agent #001          -> ${agent.slug} (${agent.id})`);
  } finally {
    db.close();
  }
}

main();
