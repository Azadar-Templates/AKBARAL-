-- 0016: MASTER workspace versioned artifacts + treasury transfers.
--
-- project_artifacts: real, versioned project deliverables (website HTML,
-- documents, data, image references) produced by MASTER workflows. The
-- website-builder flow captures a new version whenever a completed workflow
-- section yields a full HTML document; iterative goals ("delete this
-- section", "change the design") receive the latest version as context, so
-- modifications operate on ACTUAL project state. Undo = revert creates a new
-- version with an older version's content (history is never rewritten).
--
-- economy_transfers: controlled movement of REALIZED agent surplus into the
-- main treasury. Every row carries source, destination, amount, currency,
-- reason, authorization state and a UNIQUE idempotency key. Execution only
-- ever happens through owner approval, and only when the agent account has
-- genuinely realized (evidence-backed) net revenue covering the amount.
-- Balances are derived from the real ledger — nothing here can create money.

CREATE TABLE project_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- website|document|data|image
  title TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  source_workflow_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, kind, version)
);

CREATE INDEX idx_project_artifacts_latest
  ON project_artifacts(project_id, kind, version DESC);

CREATE TABLE economy_transfers (
  id TEXT PRIMARY KEY,
  source_agent_slug TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT 'treasury',  -- main treasury (only destination today)
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',       -- proposed|executed|rejected
  idempotency_key TEXT NOT NULL UNIQUE,
  proposed_by TEXT NOT NULL,                     -- agent slug or owner user id
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_economy_transfers_status ON economy_transfers(status, created_at DESC);
