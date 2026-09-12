import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { env, validateEnvironment } from './config/env';
import { authRouter } from './routes/auth';
import { agentsRouter } from './routes/agents';
import { meRouter } from './routes/me';
import { createTasksRouter } from './routes/tasks';
import { createWorkflowsRouter } from './routes/workflows';
import { createAutomationsRouter } from './routes/automations';
import { createOAuthRouter } from './routes/oauth';
import { createMasterRouter } from './routes/master';
import { executionQueue } from './orchestrator/queue';
import { automationScheduler } from './automation/scheduler';
import { createProjectsRouter } from './routes/projects';
import { createFilesRouter } from './routes/files';
import { createBillingRouter } from './routes/billing';
import { createAdminRouter } from './routes/admin';
import { createToolsRouter } from './routes/tools';
import { createModelsRouter } from './routes/models';
import { createFactoryRouter } from './routes/factory';
import { createMarketplaceRouter } from './routes/marketplace';
import { createWorldRouter } from './routes/world';
import { createPublicRouter } from './routes/public';
import { createContactRouter } from './routes/contact';
import { createRealtimeRouter } from './routes/realtime';
import { createNotificationsRouter } from './routes/notifications';
import { createCrmRouter } from './routes/crm';
import { createTrustRouter } from './routes/trust';
import { errorHandler, notFound } from './server/http';
import { livenessPayload, readinessPayload, prometheusMetrics } from './server/health';
import { requireAuth } from './server/middleware/auth';
import { requireRole } from './server/middleware/rbac';
import { ExecutionStream } from './realtime/execution-stream';
import { rateLimit } from './server/middleware/rate-limit';
import { requestLog } from './server/middleware/observability';

export interface ApiServer {
  app: express.Express;
  server: http.Server;
  stream: ExecutionStream;
  listen(requestedPort?: number): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/**
 * Cache-control for the SPA and its static assets.
 *
 * The HTML entrypoint and the versioned stylesheet/script are keyed to each
 * commit (see public/index.html ?v=...). We intentionally avoid long-lived
 * caching so an embedded preview that previously loaded an older build at the
 * same URL is forced to revalidate instead of showing a stale black theme.
 */
function cacheHeaders(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const isHtml = req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html') || !req.path.includes('.'));
  if (isHtml) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  next();
}

function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', CSP);
  next();
}

function corsHeaders(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const origin = req.header('origin');
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-AKBARAL-Signature');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

export function createApiServer(): ApiServer {
  // Embedded/test callers get the same mandatory-config validation. The
  // production SESSION_SECRET requirement is enforced by validateEnvironment().
  validateEnvironment();
  const app = express();
  const server = http.createServer(app);
  const stream = new ExecutionStream(server);

  // Bind the real-time stream to the persistent execution engine and start
  // its worker loop (idempotent across repeated server construction).
  executionQueue.bindStream(stream);
  executionQueue.start();

  // Start the durable automation scheduler (idempotent; same pattern as the
  // execution queue — it ticks once per second, firing due automations and
  // reconciling open runs against the authoritative job state).
  automationScheduler.start();

  app.set('trust proxy', env.trustProxy);
  app.use(securityHeaders);
  app.use(cacheHeaders);
  app.use(corsHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use(requestLog());
  app.use(rateLimit({ prefix: 'api', max: 300, windowMs: 60_000 }));
  app.use('/api/auth', rateLimit({ prefix: 'auth', max: 30, windowMs: 60_000 }));
  // The Express service is the API/backend. The premium homepage and SPA shell
  // are served by the Next.js App Router on :3000; proxies in next.config.mjs
  // route /api and /uploads back to this server.
  app.get('/', (_req, res) => {
    res.redirect('http://localhost:3000/');
  });

  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir, {
    setHeaders(resObject, filePath) {
      // Never let an embedded/preview browser keep a stale entrypoint or a
      // stale version of the redesigned stylesheet/script. Static assets are
      // versioned in the markup (?v=...), so max-age=0 + must-revalidate is
      // enough for them.
      if (String(filePath).endsWith('.html')) {
        resObject.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        resObject.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },
  }));

  app.use('/api/auth', authRouter);
  app.use('/api/auth/oauth', createOAuthRouter());
  app.get('/api/health', (_req, res) => {
    // Liveness: honest probe — if the database round trip fails the process
    // is degraded, not "ok" (the old payload reported database:'ok'
    // unconditionally).
    const payload = livenessPayload();
    res.status(payload.status === 'ok' ? 200 : 503).json(payload);
  });
  app.get('/api/ready', (_req, res) => {
    // Readiness: DB + migrations + uploads + queue worker. Load balancers
    // and container orchestrators gate traffic on this.
    const payload = readinessPayload();
    res.status(payload.status === 'ready' ? 200 : 503).json(payload);
  });
  app.get('/api/metrics', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
    // Prometheus text-format metrics for scraping. Admin-only: the series
    // include business counters (users, revenue, queue depth).
    res.status(200).type('text/plain; version=0.0.4').send(prometheusMetrics());
  });
  app.use('/api/me', meRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/tasks', createTasksRouter(stream));
  app.use('/api/workflows', createWorkflowsRouter(stream));
  app.use('/api/automations', createAutomationsRouter());
  app.use('/api/master', createMasterRouter(stream));
  app.use('/api/projects', createProjectsRouter());
  app.use('/api', createFilesRouter());
  app.use('/api/billing', createBillingRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/api/tools', createToolsRouter());
  app.use('/api/models', createModelsRouter());
  app.use('/api/factory', createFactoryRouter());
  app.use('/api/marketplace', createMarketplaceRouter());
  app.use('/api/world', createWorldRouter());
  // Public read-only catalog (powers the /agents directory page; platform agents only)
  app.use('/api/public', createPublicRouter());
  // Public contact form — strict dedicated rate limit (anti-abuse).
  app.use('/api/contact', rateLimit({ prefix: 'contact', max: 5, windowMs: 60_000 }));
  app.use('/api/contact', createContactRouter());
  app.use('/api', createRealtimeRouter());
  app.use('/api/notifications', createNotificationsRouter());
  app.use('/api/crm', createCrmRouter());
  app.use('/api', createTrustRouter());

  app.use(notFound);
  app.use(errorHandler);

  return {
    app,
    server,
    stream,
    async listen(requestedPort?: number): Promise<{ port: number; host: string }> {
      return new Promise((resolve, reject) => {
        const port = requestedPort ?? env.port;
        server.once('error', reject);
        server.listen(port, env.host, () => {
          server.removeListener('error', reject);
          const address = server.address();
          const boundPort = typeof address === 'object' && address ? address.port : port;
          resolve({ port: boundPort, host: env.host });
        });
      });
    },
    async close(): Promise<void> {
      automationScheduler.stop();
      stream.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
