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
import { syncAgentRegistry, countAgentRegistry } from './agents/registry';
import { agentDefinitionCount } from './agents/catalog';
import { recoverInterruptedWork } from './orchestrator/recovery';
import { executionQueue } from './orchestrator/queue';

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
  // Drain the execution queue FIRST so in-flight jobs either finish or are
  // requeued by crash recovery on the next boot; then close HTTP and the DB.
  try {
    executionQueue.stop();
    console.log('[akbaral] execution queue stopped');
  } catch (error) {
    console.error(`[akbaral] queue stop error: ${error instanceof Error ? error.message : String(error)}`);
  }
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

  // Crash recovery: before accepting traffic, reconcile non-terminal
  // workflows/tasks/executions from a previous process and refund their
  // reserved task credits (trust policy under crashes).
  const recovery = recoverInterruptedWork();
  if (recovery.tasks > 0 || recovery.workflows > 0) {
    console.log(
      `[akbaral] crash recovery: ${recovery.workflows} workflow(s), ${recovery.tasks} task(s), ` +
        `${recovery.executions} execution(s) marked failed; ${recovery.creditsRefunded} credit(s) refunded`,
    );
  }

  const api = createApiServer();
  activeServer = api;
  const { port } = await api.listen();
  console.log(`[akbaral] api listening on ${env.host}:${port}`);
  console.log(
    `[akbaral] realtime logs at ${
      process.env.AKBARAL_REALTIME_TRANSPORT === 'sse'
        ? '/api/executions/:id/events (SSE-only mode — free-tier compatible)'
        : '/ws/executions/:executionId'
    }`,
  );

  // Self-heal a fresh/incomplete deployment without blocking the health check.
  // The specialist registry sync is idempotent but slow (~40s for 4,001 agents)
  // — running it before `api.listen()` meant the container never became
  // \"ready\" within StackHost's 3-second startup probe and was killed with
  // no useful log. Now the API is already listening on :4000 (and the web
  // tier via the Next.js proxy is already healthy), so the sync can run in
  // the background and catch up without failing the probe.
  if (countAgentRegistry() < agentDefinitionCount()) {
    console.log('[akbaral] agent registry incomplete — syncing specialist catalog...');
    setImmediate(() => {
      try {
        const registry = syncAgentRegistry();
        console.log(`[akbaral] agent registry ready: ${registry.total} specialists`);
      } catch (error) {
        console.error(
          '[akbaral] failed to sync catalog (background):',
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }

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
