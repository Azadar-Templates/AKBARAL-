import { db } from './database';
import { createId } from './id';
import { DEFAULT_FREE_CREDITS } from './constants';
import {
  ensureBootstrapPlans,
  ensureEntitlement,
  ensureProfile,
  createSubscription,
} from './platform-repositories';

/**
 * Typed repository layer for Phase 1.
 *
 * These are real SQL operations against the migration-created schema. The layer
 * is intentionally thin: the rest of the platform composes these operations
 * into workflows (orchestrator -> agents -> tools -> verification), and later
 * phases can extend or swap the implementation without touching callers.
 */

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  password_hash: string | null;
  email_verified_at: string | null;
  last_login_at: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditAccountRow {
  id: string;
  user_id: string;
  free_credits: number;
  free_credits_used: number;
  paid_credits: number;
  bonus_credits: number;
  status: string;
  last_credit_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditTransactionRow {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  user_id: string;
  task_id: string | null;
  reason: string | null;
  status: string;
  reference: string | null;
  created_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  type: string | null;
  input_data: string | null;
  output_data: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  user_id: string;
  project_id: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string;
  category_id: string | null;
  runtime: string;
  status: string;
  owner_id: string | null;
  project_id: string | null;
  config: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentExecutionMinimal {
  id: string;
  agent_id: string;
  task_id: string | null;
  status: string;
  input_data: string | null;
  error_message: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const NOW = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Users & authentication
// ---------------------------------------------------------------------------

export function createUser(input: {
  email: string;
  name?: string | null;
  role?: string;
  status?: string;
  passwordHash?: string | null;
  metadata?: Record<string, unknown> | null;
  freeCredits?: number;
}): UserRow {
  const id = createId('usr');
  const now = NOW();

  return db.transaction((tx) => {
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const passwordHash = input.passwordHash ?? null;

    tx.run(
      `INSERT INTO users (id, email, name, role, status, password_hash, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.email,
        input.name ?? null,
        input.role ?? 'user',
        input.status ?? 'active',
        passwordHash,
        metadata,
        now,
        now,
      ],
    );

    tx.run(
      `INSERT INTO credit_accounts (id, user_id, free_credits, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [createId('crd'), id, input.freeCredits ?? DEFAULT_FREE_CREDITS, now, now],
    );

    ensureBootstrapPlans();
    ensureProfile(id);
    createSubscription({
      userId: id,
      planKey: 'free',
      status: 'trialing',
      billingProvider: 'manual',
      trialDays: 30,
    });
    ensureEntitlement(id, 'trial', `30 days`);
    ensureEntitlement(id, 'free_tasks', `${input.freeCredits ?? DEFAULT_FREE_CREDITS}`);
    ensureEntitlement(id, 'custom_credits', 'false');
    ensureEntitlement(id, 'agent_world', 'true');
    ensureEntitlement(id, 'agent_factory', 'true');

    const row = tx.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) {
      throw new Error(`failed to read created user ${id}`);
    }
    return row;
  });
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email]);
}

export function findUserById(id: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
}

export function setUserPasswordHash(userId: string, passwordHash: string): void {
  db.run(
    `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [passwordHash, userId],
  );
}

export function updateUserLastLogin(id: string, when: string): void {
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [when, id]);
}

export function createSession(input: {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): { id: string } {
  const id = createId('ses');
  db.run(
    `INSERT INTO sessions (id, token_hash, user_id, ip_address, user_agent, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.tokenHash, input.userId, input.ipAddress ?? null, input.userAgent ?? null, input.expiresAt, NOW()],
  );
  return { id };
}

export function findSessionByTokenHash(tokenHash: string): { id: string; user_id: string; expires_at: string; revoked_at: string | null } | undefined {
  return db.get<{ id: string; user_id: string; expires_at: string; revoked_at: string | null }>(
    `SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?`,
    [tokenHash],
  );
}

export function revokeSession(id: string): void {
  db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [NOW(), id]);
}

export function rotateSessionLastSeen(id: string): void {
  db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [NOW(), id]);
}

export function createApiKey(input: {
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes?: string;
  expiresAt?: string | null;
}): { id: string } {
  const id = createId('key');
  db.run(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, scopes, user_id, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.keyPrefix, input.keyHash, input.scopes ?? '', input.userId, input.expiresAt ?? null, NOW(), NOW()],
  );
  return { id };
}

// ---------------------------------------------------------------------------
// Credits / free-task economy
// ---------------------------------------------------------------------------

export function getCreditAccount(userId: string): CreditAccountRow | undefined {
  return db.get<CreditAccountRow>('SELECT * FROM credit_accounts WHERE user_id = ?', [userId]);
}

export function grantCredit(input: {
  userId: string;
  amount: number;
  reason?: string;
  reference?: string;
  type?: string;
}): CreditTransactionRow | undefined {
  return db.transaction((tx) => {
    const account = tx.get<CreditAccountRow>('SELECT * FROM credit_accounts WHERE user_id = ?', [input.userId]);
    if (!account) {
      throw new Error(`credit account not found for user ${input.userId}`);
    }

    const nextFree = account.free_credits + input.amount;
    tx.run(
      `UPDATE credit_accounts SET free_credits = ?, last_credit_at = ? WHERE user_id = ?`,
      [nextFree, NOW(), input.userId],
    );

    const id = createId('crx');
    tx.run(
      `INSERT INTO credit_transactions (id, type, amount, balance_after, user_id, reason, status, reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      [id, input.type ?? 'grant', input.amount, nextFree, input.userId, input.reason ?? null, input.reference ?? null, NOW()],
    );

    return tx.get<CreditTransactionRow>('SELECT * FROM credit_transactions WHERE id = ?', [id]);
  });
}

/**
 * Consume exactly one free task credit.
 *
 * The update is guarded by `free_credits > 0`, so concurrent requests cannot
 * over-consume. Returns the transaction row when successful.
 */
export function consumeFreeCredit(input: {
  userId: string;
  taskId: string;
  reason?: string;
}): CreditTransactionRow | undefined {
  return db.transaction((tx) => {
    const account = tx.get<CreditAccountRow>('SELECT * FROM credit_accounts WHERE user_id = ?', [input.userId]);
    if (!account || account.status !== 'active' || account.free_credits <= 0) {
      return undefined;
    }

    const nextFree = account.free_credits - 1;
    const result = tx.run(
      `UPDATE credit_accounts
       SET free_credits = ?, free_credits_used = free_credits_used + 1, last_credit_at = ?
       WHERE user_id = ? AND free_credits = ?`,
      [nextFree, NOW(), input.userId, account.free_credits],
    );

    if (result.changes !== 1) {
      return undefined;
    }

    const id = createId('crx');
    tx.run(
      `INSERT INTO credit_transactions (id, type, amount, balance_after, user_id, task_id, reason, status, created_at)
       VALUES (?, 'consume_task', -1, ?, ?, ?, ?, 'completed', ?)`,
      [id, nextFree, input.userId, input.taskId, input.reason ?? null, NOW()],
    );

    return tx.get<CreditTransactionRow>('SELECT * FROM credit_transactions WHERE id = ?', [id]);
  });
}

/**
 * Automatically refund a consumed free-task credit on failure / Pro requirement.
 * The user consumes a task only once, so a refund is a +1 credit transaction.
 */
export function refundCredit(input: {
  userId: string;
  taskId: string;
  reason?: string;
}): CreditTransactionRow | undefined {
  return db.transaction((tx) => {
    const account = tx.get<CreditAccountRow>('SELECT * FROM credit_accounts WHERE user_id = ?', [input.userId]);
    if (!account) {
      return undefined;
    }

    const nextFree = account.free_credits + 1;
    tx.run(
      `UPDATE credit_accounts
       SET free_credits = ?, free_credits_used = MAX(0, free_credits_used - 1), last_credit_at = ?
       WHERE user_id = ?`,
      [nextFree, NOW(), input.userId],
    );

    const id = createId('crx');
    tx.run(
      `INSERT INTO credit_transactions (id, type, amount, balance_after, user_id, task_id, reason, status, created_at)
       VALUES (?, 'refund_task', 1, ?, ?, ?, ?, 'completed', ?)`,
      [id, nextFree, input.userId, input.taskId, input.reason ?? null, NOW()],
    );

    return tx.get<CreditTransactionRow>('SELECT * FROM credit_transactions WHERE id = ?', [id]);
  });
}

export function listCreditTransactions(userId: string, limit = 50): CreditTransactionRow[] {
  return db.all<CreditTransactionRow>(
    'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit],
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function createProject(input: { ownerId: string; name: string; slug: string; description?: string | null }): { id: string } {
  const id = createId('prj');
  const now = NOW();
  db.run(
    `INSERT INTO projects (id, name, slug, description, status, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    [id, input.name, input.slug, input.description ?? null, input.ownerId, now, now],
  );
  return { id };
}

export function findProjectBySlug(slug: string): { id: string } | undefined {
  return db.get<{ id: string }>('SELECT id FROM projects WHERE slug = ?', [slug]);
}

// ---------------------------------------------------------------------------
// Agent taxonomy
// ---------------------------------------------------------------------------

export function createAgentCategory(input: { name: string; slug: string; description?: string | null }): { id: string } {
  const id = createId('cat');
  const now = NOW();
  db.run(
    `INSERT INTO agent_categories (id, name, slug, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.slug, input.description ?? null, now, now],
  );
  return { id };
}

export function createAgent(input: {
  name: string;
  slug: string;
  description?: string | null;
  categoryId?: string | null;
  ownerId?: string | null;
  projectId?: string | null;
  config?: Record<string, unknown> | null;
  version?: string;
  status?: string;
}): AgentRow {
  const id = createId('agt');
  const now = NOW();
  db.run(
    `INSERT INTO agents
       (id, name, slug, description, version, category_id, runtime, status, owner_id, project_id, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'node', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.slug,
      input.description ?? null,
      input.version ?? '1.0.0',
      input.categoryId ?? null,
      input.status ?? 'active',
      input.ownerId ?? null,
      input.projectId ?? null,
      input.config ? JSON.stringify(input.config) : null,
      now,
      now,
    ],
  );

  const row = db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [id]);
  if (!row) {
    throw new Error(`failed to read created agent ${id}`);
  }
  return row;
}

export function findAgentBySlug(slug: string): AgentRow | undefined {
  return db.get<AgentRow>('SELECT * FROM agents WHERE slug = ?', [slug]);
}

export function listAgents(limit = 100, offset = 0): AgentRow[] {
  return db.all<AgentRow>('SELECT * FROM agents ORDER BY name LIMIT ? OFFSET ?', [limit, offset]);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function createTask(input: {
  userId: string;
  title: string;
  description?: string | null;
  type?: string;
  projectId?: string | null;
  agentId?: string | null;
  priority?: number;
  inputData?: Record<string, unknown> | null;
}): TaskRow {
  const id = createId('tsk');
  const now = NOW();
  db.run(
    `INSERT INTO tasks
       (id, title, description, status, priority, type, input_data, user_id, project_id, agent_id, created_at, updated_at)
     VALUES (?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.description ?? null,
      input.priority ?? 0,
      input.type ?? null,
      input.inputData ? JSON.stringify(input.inputData) : null,
      input.userId,
      input.projectId ?? null,
      input.agentId ?? null,
      now,
      now,
    ],
  );

  const row = db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!row) {
    throw new Error(`failed to read created task ${id}`);
  }
  return row;
}

export function findTaskById(id: string): TaskRow | undefined {
  return db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
}

export function listTasksByUser(
  userId: string,
  result: { limit: number; offset: number },
): Array<TaskRow & { agent_name: string | null }> {
  return db.all<TaskRow & { agent_name: string | null }>(
    `SELECT tasks.*, agents.name AS agent_name
     FROM tasks
     LEFT JOIN agents ON agents.id = tasks.agent_id
     WHERE tasks.user_id = ?
     ORDER BY tasks.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, result.limit, result.offset],
  );
}

export function updateTaskStatus(input: {
  id: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
}): void {
  db.run(
    `UPDATE tasks
     SET status = ?,
         started_at = COALESCE(?, started_at),
         completed_at = COALESCE(?, completed_at),
         error_message = ?
     WHERE id = ?`,
    [input.status, input.startedAt ?? null, input.completedAt ?? null, input.errorMessage ?? null, input.id],
  );
}

export function updateTaskOutput(input: { id: string; outputData: Record<string, unknown> | null }): void {
  db.run('UPDATE tasks SET output_data = ? WHERE id = ?', [
    input.outputData ? JSON.stringify(input.outputData) : null,
    input.id,
  ]);
}

export function appendTaskEvent(input: {
  taskId: string;
  message: string;
  level?: string;
  type?: string;
  executionId?: string | null;
  data?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('evt');
  db.run(
    `INSERT INTO task_events (id, task_id, execution_id, level, type, message, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.taskId, input.executionId ?? null, input.level ?? 'info', input.type ?? 'status', input.message, input.data ? JSON.stringify(input.data) : null, NOW()],
  );
  return { id };
}

export function listTaskEvents(taskId: string, limit = 200): Array<Record<string, unknown>> {
  return db.all<Record<string, unknown>>(
    'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?',
    [taskId, limit],
  );
}

// ---------------------------------------------------------------------------
// Agent executions & logs
// ---------------------------------------------------------------------------

export function createAgentExecution(input: {
  agentId: string;
  taskId?: string | null;
  inputData?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('exe');
  db.run(
    `INSERT INTO agent_executions (id, agent_id, task_id, status, input_data, attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, 0, ?, ?)`,
    [id, input.agentId, input.taskId ?? null, input.inputData ? JSON.stringify(input.inputData) : null, NOW(), NOW()],
  );
  return { id };
}

export function getAgentExecution(id: string): AgentExecutionMinimal | undefined {
  return db.get<AgentExecutionMinimal>('SELECT * FROM agent_executions WHERE id = ?', [id]);
}

export function listTaskExecutions(taskId: string, limit = 100): AgentExecutionMinimal[] {
  return db.all<AgentExecutionMinimal>(
    'SELECT * FROM agent_executions WHERE task_id = ? ORDER BY created_at DESC LIMIT ?',
    [taskId, limit],
  );
}

export function updateAgentExecutionStatus(input: {
  id: string;
  status: string;
  outputData?: Record<string, unknown> | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}): void {
  db.run(
    `UPDATE agent_executions
     SET status = ?,
         output_data = ?,
         error_message = ?,
         duration_ms = ?,
         started_at = COALESCE(?, started_at),
         completed_at = COALESCE(?, completed_at)
     WHERE id = ?`,
    [
      input.status,
      input.outputData ? JSON.stringify(input.outputData) : null,
      input.errorMessage ?? null,
      input.durationMs ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
      input.id,
    ],
  );
}

export function appendAgentExecutionLog(input: {
  executionId: string;
  message: string;
  level?: string;
  type?: string;
  data?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('log');
  db.run(
    `INSERT INTO agent_execution_logs (id, execution_id, level, type, message, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.executionId, input.level ?? 'info', input.type ?? 'log', input.message, input.data ? JSON.stringify(input.data) : null, NOW()],
  );
  return { id };
}

export function listExecutionLogs(executionId: string, limit = 500): Array<Record<string, unknown>> {
  return db.all<Record<string, unknown>>(
    'SELECT * FROM agent_execution_logs WHERE execution_id = ? ORDER BY created_at ASC LIMIT ?',
    [executionId, limit],
  );
}

export interface ExecutionLogRow {
  id: string;
  execution_id: string;
  level: string;
  type: string;
  message: string;
  data: string | null;
  created_at: string;
}

/**
 * Return logs newer than the `after` cursor.
 * The cursor is `created_at` (ISO string) because log ids are opaque.
 */
export function listExecutionLogsAfter(
  executionId: string,
  afterCreatedAt: string | null,
  limit = 500,
): ExecutionLogRow[] {
  if (!afterCreatedAt) {
    return db.all<ExecutionLogRow>(
      `SELECT * FROM agent_execution_logs
       WHERE execution_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
      [executionId, limit],
    );
  }
  return db.all<ExecutionLogRow>(
    `SELECT * FROM agent_execution_logs
     WHERE execution_id = ? AND created_at > ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [executionId, afterCreatedAt, limit],
  );
}

// ---------------------------------------------------------------------------
// Tool / API integrations
// ---------------------------------------------------------------------------

export function createToolIntegration(input: {
  name: string;
  type: string;
  userId?: string | null;
  projectId?: string | null;
  scopes?: string;
  environment?: string;
  encryptedConfig?: string | null;
  configKeyRef?: string | null;
}): { id: string } {
  const id = createId('int');
  const now = NOW();
  db.run(
    `INSERT INTO tool_integrations
       (id, name, type, status, environment, encrypted_config, config_key_ref, scopes, user_id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.type,
      input.environment ?? 'development',
      input.encryptedConfig ?? null,
      input.configKeyRef ?? null,
      input.scopes ?? '',
      input.userId ?? null,
      input.projectId ?? null,
      now,
      now,
    ],
  );
  return { id };
}

export function linkAgentIntegration(input: { agentId: string; integrationId: string; scope?: string }): void {
  db.run(
    `INSERT OR IGNORE INTO agent_integrations (agent_id, integration_id, scope, created_at)
     VALUES (?, ?, ?, ?)`,
    [input.agentId, input.integrationId, input.scope ?? 'read', NOW()],
  );
}

// ---------------------------------------------------------------------------
// Usage & audit
// ---------------------------------------------------------------------------

export function recordUsage(input: {
  userId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  executionId?: string | null;
  metric: string;
  value: number;
  unit: string;
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('usg');
  db.run(
    `INSERT INTO usage_records
       (id, user_id, project_id, task_id, agent_id, execution_id, metric, value, unit, metadata, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId ?? null,
      input.projectId ?? null,
      input.taskId ?? null,
      input.agentId ?? null,
      input.executionId ?? null,
      input.metric,
      input.value,
      input.unit,
      input.metadata ? JSON.stringify(input.metadata) : null,
      NOW(),
    ],
  );
  return { id };
}

export function appendAuditLog(input: {
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('aud');
  db.run(
    `INSERT INTO audit_logs
       (id, actor_id, action, resource_type, resource_id, ip_address, user_agent, description, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.actorId ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.description ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      NOW(),
    ],
  );
  return { id };
}

export function appendSecurityLog(input: {
  userId?: string | null;
  eventType: string;
  severity?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('sec');
  db.run(
    `INSERT INTO security_logs
       (id, user_id, event_type, severity, ip_address, user_agent, description, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId ?? null,
      input.eventType,
      input.severity ?? 'info',
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.description ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      NOW(),
    ],
  );
  return { id };
}
