/**
 * AKBARAL! / MASTER AI — application bootstrap.
 *
 * Starts the API server (auth, agents, tasks), the SQLite database layer, and
 * the WebSocket execution-log stream.
 */
import { env, validateEnvironment } from './config/env';
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

let activeServer: ReturnType<typeof createApiServer> | null = null;

function shutdown(signal: string): void {
  console.log(`[akbaral] received ${signal}, shutting down`);
  if (activeServer) {
    activeServer.close()
      .then(() => {
        db.close();
        process.exit(0);
      })
      .catch((error) => {
        console.error(`[akbaral] shutdown error: ${error instanceof Error ? error.message : String(error)}`);
        db.close();
        process.exit(1);
      });
    return;
  }
  db.close();
  process.exit(0);
}

async function start(): Promise<void> {
  // Validates mandatory runtime config before the DB/server starts. Provider
  // credentials remain optional and are surfaced only as configured booleans.
  validateEnvironment();

  try {
    ensureBootstrapPlans();
    syncModelCatalog();
  } catch (error) {
    console.error('[akbaral] failed to sync catalog:', error instanceof Error ? error.message : String(error));
  }
  checkDatabase();

  const api = createApiServer();
  activeServer = api;
  const { port } = await api.listen();
  console.log(`[akbaral] api listening on ${env.host}:${port}`);
  console.log(`[akbaral] realtime logs at /ws/executions/:executionId`);

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // Never dump raw exceptions that could carry sensitive values.
  console.error(`[akbaral] failed to start: ${message}`);
  db.close();
  process.exit(1);
});
