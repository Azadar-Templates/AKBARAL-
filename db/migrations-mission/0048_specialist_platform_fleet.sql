-- ZA141251SA SPECIALIST FLEET — verified platform catalog, one-to-one primary
-- assignments, persistent expert profiles, measured competency evidence and an
-- explicit per-agent readiness ladder.
--
-- WHY THIS EXISTS. Registering thousands of agents and naming them specialists is
-- trivial; what was missing is the part that can be audited: a platform row whose
-- status is backed by a dated verification record, an assignment that cannot
-- duplicate, a profile that carries the platform's real rules and least-privilege
-- permissions, and a state that only advances when the check behind it actually
-- passed. Every table below is written by code that refuses to invent the fact it
-- records: an unverified platform stays DISCOVERED, an agent with no passing
-- evaluation never becomes SKILLS_VERIFIED, and an agent without an approved
-- contract cannot be EXECUTION_READY.
--
-- These rows authorize nothing on their own. Account creation, identity/KYC,
-- credential writes, external submissions and payout changes stay owner-only, and
-- `mission_agent_contracts` remains the only money-grant authority.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Verification record per platform. One row per observed fact-set, so a stale
--    verification is visible as a stale row rather than a silent lie in the status.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_platform_evidence (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES mission_platforms(id) ON DELETE CASCADE,
  -- `active` = open, work exists, payment is reachable for a compliant participant.
  -- `inactive` = wound down / closed. `blocked` = inaccessible to us (no account path,
  -- automation refused at the edge, invite-only). `unsuitable` = not a marketplace for
  -- this fleet (e.g. a single program rather than a platform, or work we must not do).
  -- `unverified` = discovered, but nobody has checked it: never treated as available.
  verdict TEXT NOT NULL CHECK (verdict IN ('active','inactive','blocked','unsuitable','unverified')),
  verdict_reason TEXT NOT NULL,
  official_url TEXT NOT NULL,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  facts_json TEXT NOT NULL DEFAULT '{}',
  automation_policy TEXT NOT NULL CHECK (automation_policy IN ('permitted','restricted','prohibited','unknown')),
  open_opportunities INTEGER,
  max_reward_usd_cents INTEGER,
  observed_at TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_via TEXT NOT NULL DEFAULT 'documented',
  content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (platform_id, content_digest)
);
CREATE INDEX IF NOT EXISTS idx_platform_evidence_lookup ON mission_platform_evidence(platform_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_platform_evidence_verdict ON mission_platform_evidence(verdict, observed_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. One agent = one primary platform, and one platform is the primary of at most
--    one agent. Partial unique indexes enforce both while still allowing released
--    history to be kept for audit instead of deleted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_agent_platform_assignments (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES mission_platforms(id),
  specialty_key TEXT NOT NULL,
  -- Owner-defined account grouping label only ('mission','gmail-1'..'gmail-4'). This is a
  -- bucket name for the owner's own accounts; it is never a credential, and nothing here
  -- implies an account exists or that one inbox may hold several accounts.
  gmail_group TEXT,
  slot_type TEXT NOT NULL DEFAULT 'primary' CHECK (slot_type IN ('primary')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  evidence_id TEXT REFERENCES mission_platform_evidence(id),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  released_by TEXT,
  released_at TEXT,
  release_reason TEXT,
  UNIQUE (agent_id, slot_type)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_primary_per_agent ON mission_agent_platform_assignments(agent_id) WHERE status = 'active' AND slot_type = 'primary';
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_agent_per_primary_platform ON mission_agent_platform_assignments(platform_id) WHERE status = 'active' AND slot_type = 'primary';
CREATE INDEX IF NOT EXISTS idx_platform_assignments_platform ON mission_agent_platform_assignments(platform_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_assignments_group ON mission_agent_platform_assignments(gmail_group, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The persistent specialist profile. Not a prompt and not a rename: the rules
--    bundle is content-hashed, the skills/tools/permissions are validated against the
--    real connector and class-contract registries, and the measured level only moves
--    with evaluation rows that carry their own digest.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_agent_specialists (
  agent_id TEXT PRIMARY KEY REFERENCES mission_agents(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES mission_platforms(id),
  specialty_key TEXT NOT NULL,
  display_role TEXT NOT NULL,
  agent_class TEXT NOT NULL,
  profile_version INTEGER NOT NULL DEFAULT 1,
  rules_digest TEXT NOT NULL,
  rules_json TEXT NOT NULL DEFAULT '{}',
  skills_json TEXT NOT NULL DEFAULT '[]',
  tools_json TEXT NOT NULL DEFAULT '[]',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  denied_permissions_json TEXT NOT NULL DEFAULT '[]',
  workflow_json TEXT NOT NULL DEFAULT '{}',
  deadline_policy_json TEXT NOT NULL DEFAULT '{}',
  reward_verification_json TEXT NOT NULL DEFAULT '{}',
  rejection_codes_json TEXT NOT NULL DEFAULT '[]',
  evaluation_gate_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('REGISTERED','PLATFORM_ASSIGNED','TRAINING','SKILLS_VERIFIED','ACCESS_READY','CONTRACT_APPROVED','EXECUTION_READY','WORKING','BLOCKED','INACTIVE','NEEDS_OWNER_ACTION')) DEFAULT 'PLATFORM_ASSIGNED',
  state_reason TEXT,
  state_evidence_json TEXT NOT NULL DEFAULT '{}',
  skill_level INTEGER NOT NULL DEFAULT 0 CHECK (skill_level >= 0 AND skill_level <= 100),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  trained_at TEXT,
  skills_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_specialists_platform ON mission_agent_specialists(platform_id, state);
CREATE INDEX IF NOT EXISTS idx_specialists_state ON mission_agent_specialists(state, updated_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Evaluation runs. Re-running the same suite version replaces the result for the
--    same mode, so improvement is measurable and a stale pass cannot linger.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_specialist_evaluations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES mission_platforms(id),
  suite_key TEXT NOT NULL,
  suite_version INTEGER NOT NULL,
  -- `fixture` grades the graders (test suites only; can never certify an agent),
  -- `deterministic` runs the real engines against the stored profile, and
  -- `model_assisted` additionally requires a dispatchable model path.
  mode TEXT NOT NULL CHECK (mode IN ('fixture','deterministic','model_assisted')),
  tasks_total INTEGER NOT NULL CHECK (tasks_total >= 0),
  tasks_passed INTEGER NOT NULL CHECK (tasks_passed >= 0),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  failures_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  evidence_digest TEXT NOT NULL,
  profile_rules_digest TEXT NOT NULL,
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, suite_key, suite_version, mode)
);
CREATE INDEX IF NOT EXISTS idx_specialist_eval_agent ON mission_specialist_evaluations(agent_id, suite_key, passed);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Per-specialist opportunity queue with the ranking factors kept next to the
--    score, so "why this job first" is answerable after the fact.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_specialist_opportunities (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES mission_platforms(id),
  opportunity_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  reward_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (reward_usd_cents >= 0),
  funding_verified INTEGER NOT NULL DEFAULT 0 CHECK (funding_verified IN (0,1)),
  eligibility TEXT NOT NULL DEFAULT 'unknown',
  deadline_at TEXT,
  competition TEXT,
  effort TEXT,
  fit_score INTEGER NOT NULL DEFAULT 0,
  priority_score INTEGER NOT NULL DEFAULT 0,
  factors_json TEXT NOT NULL DEFAULT '{}',
  rank INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','blocked','assigned','delivered','dropped')),
  blockers_json TEXT NOT NULL DEFAULT '[]',
  ranked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, opportunity_key)
);
CREATE INDEX IF NOT EXISTS idx_specialist_queue_rank ON mission_specialist_opportunities(agent_id, state, rank);
CREATE INDEX IF NOT EXISTS idx_specialist_queue_platform ON mission_specialist_opportunities(platform_id, priority_score);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Explicit readiness state for every registered agent, including the majority
--    that have no platform yet: `UNASSIGNED_PLATFORM` is a recorded state, not an
--    absence, so the report can say how many are waiting and why.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_agent_fleet_states (
  agent_id TEXT PRIMARY KEY REFERENCES mission_agents(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('UNASSIGNED_PLATFORM','REGISTERED','PLATFORM_ASSIGNED','TRAINING','SKILLS_VERIFIED','ACCESS_READY','CONTRACT_APPROVED','EXECUTION_READY','WORKING','BLOCKED','INACTIVE','NEEDS_OWNER_ACTION')),
  platform_id TEXT REFERENCES mission_platforms(id),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  owner_actions_json TEXT NOT NULL DEFAULT '[]',
  evidence_digest TEXT,
  refreshed_at TEXT NOT NULL,
  refreshed_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_states_state ON mission_agent_fleet_states(state, refreshed_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Transition audit. A state change without a recorded reason is not a state
--    machine, it is a status column; this is what makes a regression reviewable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_agent_state_transitions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_digest TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_state_transitions_agent ON mission_agent_state_transitions(agent_id, created_at);
