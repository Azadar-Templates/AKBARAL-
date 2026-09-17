import { db, findAgentBySlug, findUserByEmail } from './index';

/**
 * Database foundation verification.
 *
 * Run with: npm run verify:db
 *
 * Confirms that the migration has been applied and every core table is
 * queryable through the database layer. It is non-destructive.
 */
function main(): void {
  try {
    const tables = [
      'users',
      'sessions',
      'api_keys',
      'credit_accounts',
      'credit_transactions',
      'projects',
      'agent_categories',
      'agents',
      'tasks',
      'task_events',
      'agent_executions',
      'agent_execution_logs',
      'tool_integrations',
      'agent_integrations',
      'usage_records',
      'audit_logs',
      'security_logs',
    ];

    for (const table of tables) {
      if (!db.tableExists(table)) {
        throw new Error(`expected table "${table}" is missing from the schema`);
      }
    }

    const counts = tables.map((table) => {
      const row = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
      return { table, count: row?.count ?? 0 };
    });

    console.log(`[verify:db] database connection ok (${db.filePath})`);
    console.table(counts);

    const seededAgent = findAgentBySlug('web-research-001');
    if (seededAgent) {
      console.log(`[verify:db] seeded agent #001: ${seededAgent.slug} (${seededAgent.id})`);
    } else {
      console.log('[verify:db] dev seed is not present (optional; run npm run db:seed)');
    }

    const serviceUser = findUserByEmail('web-research@akbaral.ai');
    if (serviceUser) {
      console.log(`[verify:db] seeded service account: ${serviceUser.email}`);
    }
  } finally {
    db.close();
  }
}

main();
