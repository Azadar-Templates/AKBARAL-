#!/usr/bin/env node
/**
 * A stand-in for the platform preview proxy, used to reproduce browser
 * behaviour that only appears through the external preview URL (the sandbox
 * has no outbound network, so the real proxy cannot be reached from inside).
 *
 * It forwards to the mission server while behaving like a TLS-terminating
 * reverse proxy on another host, and can reproduce the specific hostile
 * behaviour under investigation: consuming the `Authorization` header for its
 * own auth so it never reaches the application.
 *
 * Env:
 *   PORT                  listen port (default 4300)
 *   TARGET                upstream origin (default http://127.0.0.1:4200)
 *   STRIP_AUTHORIZATION   1 to drop Authorization before forwarding
 *   PUBLIC_HOST           Host header to present upstream
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4300);
const TARGET = new URL(process.env.TARGET ?? 'http://127.0.0.1:4200');
const STRIP = process.env.STRIP_AUTHORIZATION === '1';
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? '4200-preview.example.app';

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  if (STRIP) delete headers.authorization;
  headers.host = PUBLIC_HOST;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = PUBLIC_HOST;
  headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';

  const upstream = http.request(
    { hostname: TARGET.hostname, port: TARGET.port, path: req.url, method: req.method, headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`upstream error: ${error.message}`);
  });
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview proxy on http://127.0.0.1:${PORT} → ${TARGET.origin} (strip-authorization=${STRIP ? 'yes' : 'no'}, host=${PUBLIC_HOST})`);
});
