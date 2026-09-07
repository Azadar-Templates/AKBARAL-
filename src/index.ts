/**
 * AKBARAL! / MASTER AI — application bootstrap.
 *
 * Starts the API server (auth, agents, tasks), the SQLite database layer, and
 * the WebSocket execution-log stream.
 */
import { env } from './config/env';
import { createApiServer } from './app';
import { db } from './db';
import { syncModelCatalog } from './models';
import { ensureBootstrapPlans } from './db';

function checkDatabase(): void {
  const [userCount, taskCount, agentCount, projectCount] = [
    db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0,
    db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tasks')?.count ?? 0,
    db.get<{ count: number }>('SELECT COUNT(*) AS count FROM agents')?.count ?? 0,
    db.get<{ count: number }>('SELECT COUNT(*) AS count FROM projects')?.count ?? 0,
  ];

  console.log('[akbaral] database connection established');
  console.log(
    `[akbaral] users=${userCount} tasks=${taskCount} agents=${agentCount} projects=${projectCount}`,
  );
}

async function start(): Promise<void> {
  try {
    ensureBootstrapPlans();
    syncModelCatalog();
  } catch (error) {
    console.error('[akbaral] failed to sync catalog:', error);
  }
  checkDatabase();

  const api = createApiServer();
  const { port } = await api.listen();
  console.log(`[akbaral] api listening on ${env.host}:${port}`);
  console.log(`[akbaral] realtime logs at /ws/executions/:executionId`);
}

start().catch((error) => {
  console.error('[akbaral] failed to start:', error);
  db.close();
  process.exit(1);
});
