/**
 * AKBARAL! / MASTER AI — application bootstrap.
 *
 * Phase 1 wires the database foundation. Later phases will mount the
 * authentication service, web-research agent, credit system and WebSocket
 * real-time log transport on top of this entrypoint.
 */
import { env } from './config/env';
import { db } from './db';

function main(): void {
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
  console.log(`[akbaral] env=${env.nodeEnv} database=${db.filePath}`);
}

try {
  main();
  db.close();
} catch (error) {
  console.error('[akbaral] failed to start:', error);
  db.close();
  process.exit(1);
}
