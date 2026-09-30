import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { env } from '../config/env';
import { executionQueue } from '../orchestrator/queue';

/**
 * Real liveness + readiness probes (Milestone 10).
 *
 * The old /api/health payload reported `database: 'ok'` unconditionally —
 * a fake signal. These probes actually exercise the dependencies:
 *
 * - liveness: is the process able to serve at all (cheap DB round trip)?
 * - readiness: can this instance safely serve production traffic — DB
 *   reachable, all migrations applied, upload directory writable, execution
 *   queue worker alive?
 *
 * Both return honest, machine-readable status; readiness is a 503 with the
 * failing checks listed until the instance is actually ready.
 */

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

function checkDatabase(): HealthCheck {
  try {
    const row = db.get<{ one: number }>('SELECT 1 AS one');
    return { name: 'database', ok: row?.one === 1 };
  } catch (error) {
    return { name: 'database', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function checkMigrationsCurrent(migrationsDir?: string): HealthCheck {
  try {
    const applied = new Set(
      (db.all('SELECT name FROM _migrations') as Array<{ name: string }>).map((row) => row.name),
    );
    const dir = migrationsDir ?? path.resolve(process.cwd(), 'db', db.engine === 'postgres' ? 'migrations-pg' : 'migrations');
    if (!fs.existsSync(dir)) {
      return { name: 'migrations', ok: false, detail: 'migrations directory missing' };
    }
    const pending = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => !applied.has(name));
    if (pending.length > 0) {
      return { name: 'migrations', ok: false, detail: `pending: ${pending.join(', ')}` };
    }
    return { name: 'migrations', ok: true };
  } catch (error) {
    return { name: 'migrations', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkUploadsWritable(): HealthCheck {
  try {
    const uploadDir = path.resolve(process.cwd(), env.uploadDir);
    fs.mkdirSync(uploadDir, { recursive: true });
    const probe = path.join(uploadDir, `.ready-probe-${process.pid}`);
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    return { name: 'uploads', ok: true };
  } catch (error) {
    return { name: 'uploads', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkQueueWorker(): HealthCheck {
  try {
    const stats = executionQueue.stats();
    return {
      name: 'execution_queue',
      // activeWorkers counts busy jobs, not a live poller: both a healthy
      // idle queue and a stopped queue can report zero. Check the lifecycle.
      ok: executionQueue.isStarted && Number.isSafeInteger(stats.activeWorkers) && stats.activeWorkers >= 0,
      detail: `started=${executionQueue.isStarted}, activeWorkers=${stats.activeWorkers}`,
    };
  } catch (error) {
    return { name: 'execution_queue', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Build identity of the RUNNING process.
 *
 * Why this exists: until now nothing in the HTTP surface said which commit a
 * deployment was serving, so "is the fix live?" could only be guessed from
 * image-tag timing. The image already carries the answer — the Dockerfile
 * writes the build's commit to /app/.image-version (CI verifies that stamp
 * matches github.sha) — it simply was not readable from outside.
 *
 * Non-sensitive by construction: commit SHA, package version and the stamp's
 * mtime only. No env values, paths, credentials or config are exposed.
 */
export interface BuildInfo {
  /** Git commit SHA the image was built from, or 'unknown'. */
  commit: string;
  /** package.json version of the running build. */
  version: string;
  /** ISO timestamp the build stamp was written, when available. */
  builtAt: string | null;
  /** Where the commit came from, so an 'unknown' is explainable. */
  source: 'image-stamp' | 'env' | 'unknown';
}

const STAMP_FILENAME = '.image-version';
let cachedBuild: BuildInfo | null = null;

function readPackageVersion(cwd: string): string {
  for (const candidate of [path.join(cwd, 'package.json'), path.resolve(__dirname, '../../package.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      // try the next candidate; an unreadable package.json is not fatal
    }
  }
  return 'unknown';
}

/** Read the build stamp. `options` bypasses the cache (tests, multi-tenant hosts). */
export function buildInfo(options?: { env?: NodeJS.ProcessEnv; cwd?: string }): BuildInfo {
  if (!options && cachedBuild) {
    return cachedBuild;
  }
  const environment = options?.env ?? process.env;
  const cwd = options?.cwd ?? process.cwd();
  const version = readPackageVersion(cwd);

  const fromEnv = (environment.AKBARAL_IMAGE_VERSION ?? '').trim();
  if (fromEnv) {
    const info: BuildInfo = { commit: fromEnv, version, builtAt: null, source: 'env' };
    if (!options) cachedBuild = info;
    return info;
  }

  // Railway injects RAILWAY_GIT_COMMIT_SHA into the RUNNING container
  // automatically for any GitHub-triggered deploy, regardless of which
  // builder produced the image (Dockerfile, Nixpacks/Railpack) and without
  // any owner configuration. This is checked before the on-disk image
  // stamp because it is the platform's own authoritative record of what it
  // deployed, whereas the file stamp can only exist when this exact
  // Dockerfile ran with an explicit --build-arg GIT_SHA=<sha> (true for the
  // CI-published GHCR image, not guaranteed for a Railway-native build).
  const fromRailway = (environment.RAILWAY_GIT_COMMIT_SHA ?? '').trim();
  if (fromRailway && fromRailway.toLowerCase() !== 'unknown') {
    const info: BuildInfo = { commit: fromRailway, version, builtAt: null, source: 'env' };
    if (!options) cachedBuild = info;
    return info;
  }

  for (const candidate of [path.join(cwd, STAMP_FILENAME), path.resolve('/app', STAMP_FILENAME)]) {
    try {
      const commit = fs.readFileSync(candidate, 'utf8').trim();
      if (commit && commit !== 'unknown') {
        let builtAt: string | null = null;
        try {
          builtAt = fs.statSync(candidate).mtime.toISOString();
        } catch {
          builtAt = null;
        }
        const info: BuildInfo = { commit, version, builtAt, source: 'image-stamp' };
        if (!options) cachedBuild = info;
        return info;
      }
    } catch {
      // no stamp at this path — fall through to the next candidate
    }
  }

  const info: BuildInfo = { commit: 'unknown', version, builtAt: null, source: 'unknown' };
  if (!options) cachedBuild = info;
  return info;
}

/** Test seam: drop the memoised stamp. */
export function resetBuildInfoCache(): void {
  cachedBuild = null;
}

export function livenessPayload(): { status: string; checks: HealthCheck[]; uptimeSeconds: number; build: BuildInfo } {
  const checks = [checkDatabase()];
  const ok = checks.every((check) => check.ok);
  return {
    status: ok ? 'ok' : 'degraded',
    checks,
    uptimeSeconds: Math.floor(process.uptime()),
    build: buildInfo(),
  };
}

export function readinessPayload(): { status: string; checks: HealthCheck[]; uptimeSeconds: number; build: BuildInfo } {
  const checks = [checkDatabase(), checkMigrationsCurrent(), checkUploadsWritable(), checkQueueWorker()];
  const ok = checks.every((check) => check.ok);
  return {
    status: ok ? 'ready' : 'not_ready',
    checks,
    uptimeSeconds: Math.floor(process.uptime()),
    build: buildInfo(),
  };
}

/**
 * Prometheus text-format metrics (Milestone 10) — every series is a real
 * measurement: process resources from Node, everything else from live
 * database queries or the execution queue. Nothing is estimated.
 */
export function prometheusMetrics(): string {
  const memory = process.memoryUsage();
  const lines: string[] = [];
  const gauge = (name: string, help: string, value: number, labels = ''): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name}${labels} ${value}`);
  };

  gauge('akbaral_process_uptime_seconds', 'Process uptime in seconds.', process.uptime());
  gauge('akbaral_process_resident_memory_bytes', 'Resident set size in bytes.', memory.rss);
  gauge('akbaral_nodejs_heap_used_bytes', 'V8 heap used in bytes.', memory.heapUsed);

  const count = (sql: string): number => Number(db.get<{ c: number }>(sql)?.c ?? 0);
  gauge('akbaral_users_total', 'Registered users.', count('SELECT COUNT(*) AS c FROM users'));
  gauge('akbaral_agents_total', 'Agents in the registry.', count('SELECT COUNT(*) AS c FROM agents'));
  gauge(
    'akbaral_tasks_total',
    'Tasks by status.',
    count("SELECT COUNT(*) AS c FROM tasks WHERE status = 'completed'"),
    '{status="completed"}',
  );
  lines.push(`akbaral_tasks_total{status="failed"} ${count("SELECT COUNT(*) AS c FROM tasks WHERE status = 'failed'")}`);
  lines.push(`akbaral_tasks_total{status="running"} ${count("SELECT COUNT(*) AS c FROM tasks WHERE status = 'running'")}`);

  const queue = executionQueue.stats();
  lines.push('# HELP akbaral_queue_jobs Execution queue job counts by status.');
  lines.push('# TYPE akbaral_queue_jobs gauge');
  // Canonical statuses always emit a sample (0 for an empty queue) so scrape
  // dashboards keep their series; anything else present in the table is
  // surfaced too.
  const queueStatuses = new Set(['pending', 'running', 'failed', 'completed', 'cancelled', ...Object.keys(queue.byStatus)]);
  for (const status of queueStatuses) {
    lines.push(`akbaral_queue_jobs{status="${status}"} ${queue.byStatus[status] ?? 0}`);
  }
  lines.push(`akbaral_queue_active_workers ${queue.activeWorkers}`);
  lines.push('# HELP akbaral_queue_active_workers Busy execution workers.');
  lines.push('# TYPE akbaral_queue_active_workers gauge');

  const dbSize = count(db.engine === 'postgres'
    ? 'SELECT pg_database_size(current_database()) AS c'
    : 'SELECT page_count * page_size AS c FROM pragma_page_count(), pragma_page_size()');
  gauge('akbaral_db_size_bytes', 'Database size in bytes.', dbSize);

  const httpWindow = db.get<{ count: number; avg: number }>(
    "SELECT COUNT(*) AS count, COALESCE(AVG(value), 0) AS avg FROM system_metrics WHERE metric = 'http_request_duration_ms' AND recorded_at >= ?",
    [new Date(Date.now() - 5 * 60 * 1000).toISOString()],
  );
  gauge('akbaral_http_requests_5m', 'HTTP requests in the last 5 minutes.', httpWindow?.count ?? 0);
  gauge('akbaral_http_request_duration_ms_avg_5m', 'Average HTTP request duration (ms) over 5 minutes.', Math.round(httpWindow?.avg ?? 0));

  return `${lines.join('\n')}\n`;
}
