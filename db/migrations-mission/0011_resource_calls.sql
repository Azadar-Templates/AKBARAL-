-- Quota reservations, not payments or proof of provider/customer acceptance.
-- Dispatched/uncertain calls retain their quota until actual usage is reconciled.
CREATE TABLE mission_resource_calls (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES mission_resources(id),
  agent_id TEXT NOT NULL REFERENCES mission_agents(id),
  idempotency_key TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  binding_snapshot TEXT NOT NULL,
  reserved_usage TEXT NOT NULL,
  actual_usage TEXT,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'dispatched', 'uncertain', 'succeeded', 'failed', 'cancelled')),
  provider_ref TEXT,
  evidence TEXT,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  resolved_at TEXT,
  UNIQUE(resource_id, idempotency_key)
);
CREATE INDEX idx_mission_resource_calls_pending ON mission_resource_calls(resource_id, status);
