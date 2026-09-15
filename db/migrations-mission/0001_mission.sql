-- ============================================================================
-- PRIVATE MISSION SYSTEM — schema (separate database, separate secrets).
--
-- This database is NOT the AKBARAL! platform database. It has its own file (or
-- its own PostgreSQL schema), its own owner authentication, its own treasury,
-- its own revenue ledger and its own audit chain. Nothing in this file is read
-- by the public AKBARAL! application, and no AKBARAL! customer revenue table is
-- referenced here. The two ledgers must never be joined.
--
-- Money is stored in integer minor units (cents) in a single configured
-- currency. Every mutation that moves money writes a ledger row; every ledger
-- row is immutable and hash-chained through mission_ledger.hash/prev_hash.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ── Identity: the private owner login (independent of AKBARAL! accounts) ────
CREATE TABLE IF NOT EXISTS mission_owner (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT NOT NULL,                 -- scrypt: scrypt$N$r$p$salt$hash
  role          TEXT NOT NULL DEFAULT 'owner', -- owner | operator (operator is read-only)
  status        TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Sessions are stored as SHA-256 hashes; the raw token only ever exists in the
-- client that received it. Rotation on login, hard expiry, explicit revocation.
CREATE TABLE IF NOT EXISTS mission_sessions (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES mission_owner(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  csrf_hash   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_sessions_owner ON mission_sessions(owner_id);

-- Scoped, expiring access links so authorized agents/operators can reach the
-- private dashboard after deployment without the dashboard being public. The
-- link is bound to a role/scope, an optional agent, a use budget and an expiry.
CREATE TABLE IF NOT EXISTS mission_access_links (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scope        TEXT NOT NULL DEFAULT 'dashboard:read', -- dashboard:read|agent:self|owner:read
  agent_id     TEXT REFERENCES mission_agents(id) ON DELETE CASCADE,
  max_uses     INTEGER,
  use_count    INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_by   TEXT,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Agent roster + expandable hierarchy ─────────────────────────────────────
-- Mirrors the AKBARAL! registry (4,001 specialist contracts) plus any
-- sub-agents created here under a signed contract. The registry copy is
-- read-only from the platform's point of view: it is produced by an explicit
-- `mission:sync-registry` command, never by a live join.
CREATE TABLE IF NOT EXISTS mission_agents (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  category       TEXT,
  role_key       TEXT,                           -- strategist|builder|validator|specialist|sub-agent
  parent_id      TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  depth          INTEGER NOT NULL DEFAULT 0,
  generation     TEXT NOT NULL DEFAULT 'registry', -- registry|custom
  status         TEXT NOT NULL DEFAULT 'active',   -- active|paused|retired
  mission_role   TEXT NOT NULL DEFAULT 'worker',   -- worker|supervisor|director
  origin_platform TEXT NOT NULL DEFAULT 'akbaral-registry',
  capabilities   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_agents_parent ON mission_agents(parent_id);
CREATE INDEX IF NOT EXISTS idx_mission_agents_depth ON mission_agents(depth);

-- Controlled, auditable authority: an agent may only spawn a sub-agent while an
-- ACTIVE contract for it exists, with declared permissions, resource limits and
-- a budget. Contracts expire.
CREATE TABLE IF NOT EXISTS mission_agent_contracts (
  id               TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE, -- the created child
  parent_agent_id  TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  purpose          TEXT NOT NULL,
  permissions      TEXT NOT NULL DEFAULT '[]',   -- JSON array of allowed permission keys
  resource_limits  TEXT NOT NULL DEFAULT '{}',   -- JSON: max_children, max_spend_cents, max_depth
  budget_cents     INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active', -- active|suspended|terminated|expired
  approved_by      TEXT,
  approved_at      TEXT,
  expires_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_contracts_agent ON mission_agent_contracts(agent_id);

-- ── Treasury: individual controlled wallets → mission treasury ──────────────
CREATE TABLE IF NOT EXISTS mission_wallets (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,                  -- agent|worker|mission|reserve|fee
  agent_id       TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  label          TEXT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  balance_cents  INTEGER NOT NULL DEFAULT 0,
  budget_cents   INTEGER NOT NULL DEFAULT 0,     -- authorised spend ceiling
  spent_cents    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active', -- active|frozen|closed
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (balance_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_mission_wallets_agent ON mission_wallets(agent_id);

-- Immutable, hash-chained money movements. A row is never updated or deleted.
CREATE TABLE IF NOT EXISTS mission_ledger (
  id            TEXT PRIMARY KEY,
  wallet_id     TEXT NOT NULL REFERENCES mission_wallets(id) ON DELETE RESTRICT,
  direction     TEXT NOT NULL,                   -- credit|debit
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  category      TEXT NOT NULL,                   -- revenue|expense|upgrade|transfer|payout|fee|adjustment
  reference     TEXT,                            -- work id, payout id, expense id…
  memo          TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'system',  -- owner|agent|system|provider
  actor_id      TEXT,
  balance_after INTEGER NOT NULL,
  prev_hash     TEXT,
  hash          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_ledger_wallet ON mission_ledger(wallet_id, created_at);

-- ── Work: what actually produced revenue ────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_work (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  category       TEXT NOT NULL,                  -- the approved activity category
  status         TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|in_progress|delivered|invoiced|paid|rejected
  client_ref     TEXT,
  revenue_cents  INTEGER NOT NULL DEFAULT 0,     -- agreed/contracted amount (may be 0 until invoiced)
  cost_cents     INTEGER NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  approved_by    TEXT,
  approved_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_work_agent ON mission_work(agent_id, status);

-- RECEIVED revenue only. `status` distinguishes expected/contracted from money
-- that actually arrived; only status='received' counts as realized revenue in
-- every report. Idempotency prevents double-counting the same payment.
CREATE TABLE IF NOT EXISTS mission_revenue (
  id              TEXT PRIMARY KEY,
  work_id         TEXT REFERENCES mission_work(id) ON DELETE SET NULL,
  agent_id        TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  wallet_id       TEXT REFERENCES mission_wallets(id) ON DELETE SET NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  source          TEXT NOT NULL,                 -- client|marketplace|product|platform|other
  status          TEXT NOT NULL DEFAULT 'expected', -- expected|contracted|received|disputed
  external_ref    TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  verifier        TEXT,                          -- owner|provider-webhook|bank-statement
  received_at     TEXT,
  memo            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_revenue_status ON mission_revenue(status, received_at);

CREATE TABLE IF NOT EXISTS mission_expenses (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  wallet_id       TEXT REFERENCES mission_wallets(id) ON DELETE SET NULL,
  category        TEXT NOT NULL,                 -- api|storage|compute|software|domain|service|other
  provider        TEXT NOT NULL,
  description     TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'requested', -- requested|approved|paid|rejected|failed
  approval_id     TEXT,
  external_ref    TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by      TEXT,                          -- agent id or owner id
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_mission_expenses_status ON mission_expenses(status, created_at);

-- ── Agent self-management: resources, credentials, upgrades, services ───────
CREATE TABLE IF NOT EXISTS mission_resources (
  id                 TEXT PRIMARY KEY,
  agent_id           TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  service_id         TEXT REFERENCES mission_services(id) ON DELETE SET NULL,
  kind               TEXT NOT NULL,              -- api|storage|compute|database|tool|domain|other
  provider           TEXT NOT NULL,
  plan               TEXT,
  monthly_cost_cents INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'requested', -- requested|approved|active|suspended|retired
  auto_renew         INTEGER NOT NULL DEFAULT 0,
  renews_at          TEXT,
  expires_at         TEXT,
  usage              TEXT,                       -- JSON usage counters (provider-reported only)
  limits             TEXT,                       -- JSON hard limits (spend/requests/storage)
  credential_id      TEXT REFERENCES mission_credentials(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mission_resources_agent ON mission_resources(agent_id, status);

-- Credentials are stored ENCRYPTED (AES-256-GCM) with a key held only in the
-- mission process environment. The API never returns a secret value: responses
-- carry provider/label/scope/masked hint/expiry only. Rotation appends to
-- mission_credential_rotations; the plaintext is never logged or audited.
CREATE TABLE IF NOT EXISTS mission_credentials (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'api_key', -- api_key|oauth_token|service_account|webhook_secret
  scope         TEXT NOT NULL DEFAULT '[]',      -- JSON array of permitted capability keys
  env_var       TEXT,                            -- preferred deployment env var name
  masked_hint   TEXT NOT NULL,                   -- e.g. "…7f2a" — never the full value
  ciphertext    TEXT NOT NULL,
  iv            TEXT NOT NULL,
  tag           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active|expiring|expired|revoked
  expires_at    TEXT,
  last_rotated_at TEXT,
  rotation_count INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mission_credential_rotations (
  id            TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES mission_credentials(id) ON DELETE CASCADE,
  reason        TEXT,
  rotated_by    TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'owner',
  new_hint      TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,      -- 1 only after a real provider call succeeded
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mission_upgrades (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  capability          TEXT NOT NULL,
  justification       TEXT,
  requested_cost_cents INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'requested', -- requested|approved|rejected|applied|rolled_back
  budget_ok           INTEGER NOT NULL DEFAULT 0,
  wallet_id           TEXT REFERENCES mission_wallets(id) ON DELETE SET NULL,
  decided_by          TEXT,
  decided_at          TEXT,
  applied_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mission_services (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,                  -- api|hosting|storage|queue|integration|other
  provider       TEXT,
  status         TEXT NOT NULL DEFAULT 'unknown', -- unknown|healthy|degraded|down|maintenance
  health_source  TEXT,                           -- provider-api|owner-check|agent-report
  last_checked_at TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Approved tool/provider catalog. Default is DENY: a tool that is not listed
-- here (or is restricted/blocked) cannot be used by any agent.
CREATE TABLE IF NOT EXISTS mission_tools (
  id                 TEXT PRIMARY KEY,
  key                TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  category           TEXT NOT NULL,
  provider           TEXT,
  cost_model         TEXT,                       -- free|metered|subscription|usage
  est_cost_cents     INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'restricted', -- approved|restricted|blocked
  required_permission TEXT,
  terms_url          TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mission_tool_requests (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  tool_key      TEXT NOT NULL,
  justification TEXT,
  status        TEXT NOT NULL DEFAULT 'requested', -- requested|approved|rejected
  decided_by    TEXT,
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Targets (aggressive revenue KPIs — targets, never claims) ───────────────
CREATE TABLE IF NOT EXISTS mission_targets (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  period        TEXT NOT NULL DEFAULT 'day',      -- day|week|month|quarter
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  currency      TEXT NOT NULL DEFAULT 'USD',
  metric        TEXT NOT NULL DEFAULT 'realized_revenue',
  status        TEXT NOT NULL DEFAULT 'active',   -- active|paused|archived
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Payout destinations: exactly four configurable slots ───────────────────
-- Slot metadata only. Account numbers are never required at setup time and are
-- stored masked: the full destination is held by the payment provider, and the
-- mission system keeps a reference plus a masked hint. A slot must be verified
-- by the owner before any payout may target it.
CREATE TABLE IF NOT EXISTS mission_payout_slots (
  slot                 INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 4),
  label                TEXT NOT NULL,
  destination_type     TEXT,                      -- bank|wallet|crypto|provider|other
  holder_name          TEXT,
  masked_account       TEXT,                      -- e.g. "**** **** 4821"
  provider_ref         TEXT,                      -- provider-side destination id
  currency             TEXT NOT NULL DEFAULT 'USD',
  min_payout_cents     INTEGER NOT NULL DEFAULT 0,
  max_payout_cents     INTEGER,
  approval_required    INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'unconfigured', -- unconfigured|pending_verification|active|paused
  configured_at        TEXT,
  verified_at          TEXT,
  verified_by          TEXT,
  notes                TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mission_payouts (
  id              TEXT PRIMARY KEY,
  slot            INTEGER NOT NULL REFERENCES mission_payout_slots(slot) ON DELETE RESTRICT,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval|approved|sent|settled|rejected|failed
  approval_id     TEXT,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  settlement_ref  TEXT,
  failure_reason  TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  settled_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_mission_payouts_status ON mission_payouts(status, created_at);

-- Central approvals queue (spend above threshold, new agents, payouts, upgrades).
CREATE TABLE IF NOT EXISTS mission_approvals (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL,                   -- payout|expense|upgrade|agent|resource|tool|policy
  subject_id    TEXT NOT NULL,
  action        TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  requested_by  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired
  decided_by    TEXT,
  decided_at    TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Immutable audit chain (append-only, hash-linked) ────────────────────────
CREATE TABLE IF NOT EXISTS mission_audit (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL,
  actor_type   TEXT NOT NULL,                    -- owner|agent|system|provider
  actor_id     TEXT,
  action       TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  detail       TEXT,                             -- JSON, secrets redacted before writing
  prev_hash    TEXT,
  hash         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_audit_seq ON mission_audit(seq);

-- ── Agent self-reports (where revenue came from, what work produced it) ─────
CREATE TABLE IF NOT EXISTS mission_reports (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT REFERENCES mission_agents(id) ON DELETE SET NULL,
  scope         TEXT NOT NULL DEFAULT 'agent',   -- agent|mission
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  payload       TEXT NOT NULL,                   -- JSON (computed from persisted state)
  checksum      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Policy (singleton) + registry sync state ────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_policy (
  id                        TEXT PRIMARY KEY,     -- 'global'
  autonomous_enabled        INTEGER NOT NULL DEFAULT 0,
  kill_switch               INTEGER NOT NULL DEFAULT 0,
  allow_agent_creation      INTEGER NOT NULL DEFAULT 1,
  max_depth                 INTEGER NOT NULL DEFAULT 3,
  max_children_per_agent    INTEGER NOT NULL DEFAULT 8,
  max_agents                INTEGER NOT NULL DEFAULT 5000,
  max_daily_spend_cents     INTEGER NOT NULL DEFAULT 10000,
  max_expense_cents         INTEGER NOT NULL DEFAULT 5000,
  max_payout_cents          INTEGER NOT NULL DEFAULT 100000,
  require_approval_above_cents INTEGER NOT NULL DEFAULT 2500,
  require_owner_for_payout  INTEGER NOT NULL DEFAULT 1,
  currency                  TEXT NOT NULL DEFAULT 'USD',
  allowed_activities        TEXT NOT NULL DEFAULT '[]',  -- JSON array
  prohibited_activities     TEXT NOT NULL DEFAULT '[]',  -- JSON array (hard block)
  provider_activation       TEXT NOT NULL DEFAULT '[]',  -- JSON: what still needs external activation
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mission_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
