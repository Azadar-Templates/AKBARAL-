import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { env } from './config/env';
import { authRouter } from './routes/auth';
import { agentsRouter } from './routes/agents';
import { meRouter } from './routes/me';
import { createTasksRouter } from './routes/tasks';
import { createWorkflowsRouter } from './routes/workflows';
import { createProjectsRouter } from './routes/projects';
import { createFilesRouter } from './routes/files';
import { createBillingRouter } from './routes/billing';
import { createAdminRouter } from './routes/admin';
import { createToolsRouter } from './routes/tools';
import { createFactoryRouter } from './routes/factory';
import { createMarketplaceRouter } from './routes/marketplace';
import { createRealtimeRouter } from './routes/realtime';
import { createNotificationsRouter } from './routes/notifications';
import { createCrmRouter } from './routes/crm';
import { errorHandler, notFound } from './server/http';
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

export function createApiServer(): ApiServer {
  const app = express();
  const server = http.createServer(app);
  const stream = new ExecutionStream(server);

  app.use(express.json({ limit: '2mb' }));
  app.use(requestLog());
  app.use(rateLimit({ prefix: 'api', max: 300, windowMs: 60_000 }));
  app.use('/api/auth', rateLimit({ prefix: 'auth', max: 30, windowMs: 60_000 }));
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use('/api/auth', authRouter);
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      name: 'AKBARAL! / MASTER AI',
      version: '0.1.0',
      phase: 'production platform',
      status: 'ok',
    });
  });
  app.use('/api/me', meRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/tasks', createTasksRouter(stream));
  app.use('/api/workflows', createWorkflowsRouter(stream));
  app.use('/api/projects', createProjectsRouter());
  app.use('/api', createFilesRouter());
  app.use('/api/billing', createBillingRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/api/tools', createToolsRouter());
  app.use('/api/factory', createFactoryRouter());
  app.use('/api/marketplace', createMarketplaceRouter());
  app.use('/api', createRealtimeRouter());
  app.use('/api/notifications', createNotificationsRouter());
  app.use('/api/crm', createCrmRouter());

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
      stream.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
