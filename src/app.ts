import express from 'express';
import http from 'node:http';
import { env } from './config/env';
import { authRouter } from './routes/auth';
import { agentsRouter } from './routes/agents';
import { meRouter } from './routes/me';
import { createTasksRouter } from './routes/tasks';
import { errorHandler, notFound } from './server/http';
import { ExecutionStream } from './realtime/execution-stream';

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
  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'AKBARAL! / MASTER AI',
      version: '0.1.0',
      phase: 'foundation + auth + agent-001 + credits + realtime-logs',
      status: 'ok',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/tasks', createTasksRouter(stream));

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
