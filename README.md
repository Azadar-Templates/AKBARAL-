# AKBARAL! / MASTER AI

Master AI operating platform:

`User Goal -> AI Core/Orchestrator -> Plan -> Specialist Agents -> Tools/APIs -> Execution -> Verification -> Final Result`

Target: 4,000+ genuinely distinct specialist agents, agent factory, marketplace, workspaces, honest credits, billing, admin, real-time logs and a premium responsive web application.

---

## Implemented Platform

### Agent Registry (4,000+ specialists)
- `src/agents/catalog.ts` generates 4,000+ genuinely differentiated agents from a combinatorial matrix of 80 professional domain blueprints × 50 specialist archetypes.
- Every agent has a unique id/slug, name, specialization, system instructions, capabilities, inputs/outputs, model requirements, tool permissions, API requirements, workflow, verification rules, security permissions, cost metadata, fallback strategy, version, health and evaluation config.
- `src/agents/registry.ts` synchronizes the full catalog into the database idempotently with SHA-256 checksums and version history (`agent_versions`).
- Discovery via `GET /api/agents`, categories via `GET /api/agents/categories`.

### MASTER AI Orchestrator
- `src/orchestrator/planner.ts` detects intents from a natural-language goal, selects real specialist agents from the DB registry, and persists a `workflows` + `workflow_steps` task graph.
- `src/orchestrator/workflow-runner.ts` executes the graph respecting `depends_on`, skipping blocked steps and aggregating results.
- `src/orchestrator/executor.ts` dispatches structured tasks/executions, routes Agent #001 to the real web-research pipeline and every other agent through the model router using that agent's genuine instructions.

### Model Router
- Provider abstraction (`openai`, `anthropic`, `google`) with honest credentials checks.
- Router scores models by capability, cost, latency, reliability, health and default preference, then uses a primary + fallback chain.
- Every run is recorded in `model_runs` for cost/latency observability.
- Missing credentials surface `provider_not_configured` + `requiredEnvKey`, never a fake result.

### Tool System
- Real tools: `web_search`, `page_fetch`, `code_repository_read`, `file_parse_text`, `knowledge_search`, `excel_build`, `image_render`.
- SSRF guard blocks private hosts; repository reads stay inside the repo; file parsing is limited to the uploads directory; image rendering requires `OPENAI_API_KEY`.
- Tool catalog is registered in DB and linked to agents through `agent_tools`.

### Agent Factory
- Create, test, security review (injection/secret/permission checks), benchmark (specialization/workflow/verification/safety scoring), version, update, publish, disable and rollback your own agents.
- `POST /api/factory/agents`, `/security`, `/benchmark`, `/version`, `/rollback`, `/status`, `PATCH /:slug`, `/audit`.

### Marketplace / Agent World
- Published agent marketplace with install counts, save/favorite relations and purchase orders.
- `GET /api/marketplace`, `/:slug/install`, `/:slug/publish`, `/:slug/unpublish`.

### Workspace + Knowledge
- Projects CRUD and project detail (files/tasks/workflows).
- File upload (multer), text/CSV/JSON extraction, file versions, knowledge indexing and FTS search.
- `POST /api/projects/:projectId/files`, `GET /api/files/:id`, `POST /api/files/:id/knowledge`, `POST /api/files/knowledge/search`.

### Honest Credit & Billing
- Every user gets a 30-day trial with 5 free tasks.
- A free credit is reserved atomically when a task starts; it is consumed only on success and automatically refunded on failure.
- When no free credit exists the API returns `402 requires_pro` with no hidden charge or task side effect.
- Plans (free/pro/enterprise), subscriptions, entitlements, invoices, payments, billing events and custom credit purchase are wired.
- `GET/POST /api/billing/*` and admin manual settlement.

### Admin Control Center
- `GET /api/admin/stats` (users, tasks, agents, models, revenue, credits, failed jobs, security events), agent/model status control, feature flags, manual payment settlement and emergency stop.

### Real-time
- WebSocket `/ws/executions/:executionId` streams persisted execution logs with reconnect replay via `?after=<ISO>`.
- SSE fallback `GET /api/executions/:id/events`.

### Web Frontend
- Premium responsive SPA in `public/` preserving the AKBARAL! visual identity and animated 3D robot.
- Landing, sign in/register, Dashboard, MASTER AI workspace, Agent World, Agent Factory, Marketplace, Workspace, CRM, Billing and Admin.

### Mobile
- Cross-platform Expo/React Native app in `mobile/` connected to the same backend.
- Login, dashboard, MASTER chat, agent discovery, workspace, billing and settings. Build with `cd mobile && npm install && npm start`.

### Business / CRM / Automation
- Contacts, pipelines, deals, campaigns, campaign messages, automations, AI employees, through `GET/POST /api/crm/*`.
- Campaign delivery requires SMTP credentials; the API fails honestly with `email_delivery_not_configured` when missing.

### Account Recovery + OAuth
- Password reset and email verification tokens are stored as hashes with expiry (`auth_tokens`).
- OAuth provider catalog reports configured status and required env vars through `/api/auth/oauth/providers`.
- Billing webhooks are verified with timing-safe HMAC signatures.

### Security / Observability
- RBAC roles (`user`, `admin`, `super_admin`), scrypt password hashing, session/refresh token hashing, short-lived JWTs, rate limiting, structured logs, system metrics, audit and security logs.
- Secrets never leave env vars; no credentials are returned to clients.

---

## Stack

- Node.js 22+ (built-in `node:sqlite`, no native SQLite deps)
- TypeScript, Express 4, `ws`, `multer`
- SQLite file database with real SQL migrations (`db/migrations/`)
- `tsx` for dev, `tsc` for production build

---

## Install

```bash
cp .env.example .env
npm install
```

## Commands

```bash
npm run db:migrate      # apply all migrations
npm run db:seed         # seed plans, model/tool catalog, 4,000-agent registry
npm run typecheck       # strict TypeScript type-check
npm run build           # compile to dist/
npm test                # full test suite
npm run dev             # run API + web app with tsx watch (port 3000)
npm run start           # run compiled production server
```

## API Overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | none | Health/status |
| POST | `/api/auth/register` | none | Create account |
| POST | `/api/auth/login` | none | Login, returns access + refresh tokens |
| GET | `/api/me` | bearer | Current user + trial + subscription |
| GET | `/api/agents` | bearer | List/discover agents |
| GET | `/api/agents/categories` | bearer | Category list |
| POST | `/api/workflows/master` | bearer | MASTER plan |
| POST | `/api/workflows/:id/run` | bearer | Execute plan |
| POST | `/api/workflows/agent` | bearer | Dispatch a specialist agent |
| POST | `/api/projects` | bearer | Create project |
| POST | `/api/projects/:id/files` | bearer | Upload file |
| POST | `/api/files/knowledge/search` | bearer | Search knowledge |
| GET | `/api/tools` | bearer | Tool catalog |
| POST | `/api/tools/:key/run` | bearer | Run a tool |
| POST | `/api/factory/agents` | bearer | Create custom agent |
| POST | `/api/marketplace/:slug/install` | bearer | Install agent |
| GET | `/api/billing/plans` | none | Public plan pricing |
| GET | `/api/admin/stats` | admin | Admin statistics |
| WS | `/ws/executions/:executionId?token=<accessToken>` | bearer via query | Live execution logs (owner-only) |
| SSE | `/api/executions/:id/events` | bearer | SSE execution logs (owner-only) |

> The WebSocket stream requires a valid access token and only streams executions owned by the current user. Unauthenticated or cross-tenant connections are rejected.

## Deployment

See [`docs/deployment.md`](./docs/deployment.md). Dockerfile, entrypoint and backup script are included.

---

## Security policy

- Passwords: salted scrypt.
- Sessions/refresh tokens: SHA-256 hashes.
- API keys/tokens: hashed, prefix-only display.
- Provider credentials: environment variables only, never DB/client.
- Files: size-limited; SSRF/path traversal guards in the tool layer.
