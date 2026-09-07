# AKBARAL! Deployment Guide

This document describes the production deployment architecture for the AKBARAL! / MASTER AI platform.

## Architecture

```
Browser / Mobile App
        |
        v
  Reverse proxy (TLS)
        |
        v
  Express API + Real-time (WebSocket / SSE)
        |
        +-- SQLite (file, WAL, read-your-writes)
        +-- File storage (data/uploads or object storage)
        +-- Background task runner (in-process workers)
        +-- External providers (OpenAI / Anthropic / Google / payment / social APIs)
        |
        v
  Shared secrets (env vars / managed secret store)
```

The deployment is intentionally simple and observable. The repository layer is isolated so SQLite can be swapped for PostgreSQL in a larger deployment.

## Environment

See `.env.example`. At minimum set:

- `DATABASE_URL`
- `SESSION_SECRET`
- `PORT`, `HOST`
- Provider credentials (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`)
- Optional search/fetch proxy (`AKBARAL_SEARCH_ENDPOINT`, `AKBARAL_PAGE_FETCH_ENDPOINT`)

Migrations must run before the API starts. The Docker entrypoint does this automatically.

## Docker

```bash
docker build -t akbaral .
docker run --rm -p 3000:3000 --env-file .env akbaral
```

With `SEED_DATABASE=true` the container seeds the plan/model/tool catalog and the 4,000-agent registry.

## Backup

```bash
./scripts/backup.sh data/akbaral.db ./backups
```

For a single-instance SQLite deployment, snapshot the database file and the uploads directory.

## Operations

- Health: `GET /api/health`
- Realtime logs: WebSocket `/ws/executions/:executionId`, SSE `/api/executions/:id/events`
- Admin control center: `/api/admin/*`

## Scaling

For higher throughput, move background execution to a job queue and replace SQLite with a managed PostgreSQL service. The orchestrator, workflow runner, agent registry and tool system are queue-agnostic.

## Security

- Secrets are never stored in the database or sent to clients.
- Provider credentials are read from environment variables only.
- Rate limits are applied at the API edge.
- File uploads are size-limited and stored outside the source tree.
- The tool system blocks private-host SSRF targets and repository path traversal.
