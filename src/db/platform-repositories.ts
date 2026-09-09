import { db } from './database';
import { createId } from './id';
import { createHash } from 'node:crypto';
import { DEFAULT_FREE_CREDITS, FREE_TRIAL_DAYS } from './constants';

/**
 * Platform repository layer (Phase 2).
 *
 * Real SQL operations for profiles, plans/subscriptions/billing, workflows,
 * agent versions/marketplace, model registry/runs, tools, files/knowledge,
 * notifications, analytics and admin actions.
 *
 * Secrets are never read from or written to these tables; provider credentials
 * stay in environment variables.
 */

const NOW = () => new Date().toISOString();

function newDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Profiles & trial
// ---------------------------------------------------------------------------

export function ensureProfile(userId: string, referralCode?: string): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM profiles WHERE user_id = ?', [userId]);
  if (existing) {
    return existing;
  }
  const id = createId('prf');
  const now = NOW();
  db.run(
    `INSERT INTO profiles (id, user_id, referral_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, referralCode ?? null, now, now],
  );
  return { id };
}

export function getProfile(userId: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM profiles WHERE user_id = ?', [userId]) as Record<string, unknown> | undefined;
}

export interface TrialStatus {
  active: boolean;
  trialStartedAt: string;
  trialEndsAt: string;
  freeCredits: number;
  freeCreditsRemaining: number;
  freeCreditsUsed: number;
  requiresPro: boolean;
}

export function getTrialStatus(userId: string): TrialStatus {
  const profile = getProfile(userId);
  const account = db.get<{
    free_credits: number;
    free_credits_used: number;
    free_credits_used_total: number | null;
    paid_credits: number;
    bonus_credits: number;
  }>(
    `SELECT ca.free_credits, ca.free_credits_used AS free_credits_used, 0 AS free_credits_used_total,
            ca.paid_credits, ca.bonus_credits
     FROM credit_accounts ca WHERE ca.user_id = ?`,
    [userId],
  );

  const trialEndsAt = (profile?.trial_ends_at as string | undefined) ?? newDate(FREE_TRIAL_DAYS);
  const trialStartedAt = (profile?.trial_started_at as string | undefined) ?? NOW();
  const active = new Date(trialEndsAt).getTime() > Date.now();
  const total = (account?.free_credits ?? 0) + (account?.paid_credits ?? 0) + (account?.bonus_credits ?? 0);

  return {
    active,
    trialStartedAt,
    trialEndsAt,
    freeCredits: DEFAULT_FREE_CREDITS,
    freeCreditsRemaining: total,
    freeCreditsUsed: account?.free_credits_used ?? 0,
    requiresPro: total <= 0,
  };
}

// ---------------------------------------------------------------------------
// Plans / subscriptions / entitlements
// ---------------------------------------------------------------------------

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: string;
  monthly_credits: number;
  max_agents: number;
  max_workspaces: number;
  max_seats: number;
  max_usage_per_day: number;
  features: string | null;
  status: string;
}

export function upsertPlan(input: {
  key: string;
  name: string;
  description?: string | null;
  priceCents?: number;
  currency?: string;
  billingInterval?: string;
  monthlyCredits?: number;
  maxAgents?: number;
  maxWorkspaces?: number;
  maxSeats?: number;
  maxUsagePerDay?: number;
  features?: Record<string, unknown>;
  sortOrder?: number;
  status?: string;
}): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM plans WHERE key = ?', [input.key]);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE plans SET name=?, description=?, price_cents=?, currency=?, billing_interval=?,
        monthly_credits=?, max_agents=?, max_workspaces=?, max_seats=?, max_usage_per_day=?, features=?, status=?, sort_order=?
       WHERE id=?`,
      [
        input.name,
        input.description ?? null,
        input.priceCents ?? 0,
        input.currency ?? 'PKR',
        input.billingInterval ?? 'month',
        input.monthlyCredits ?? 0,
        input.maxAgents ?? 3,
        input.maxWorkspaces ?? 1,
        input.maxSeats ?? 1,
        input.maxUsagePerDay ?? 0,
        input.features ? JSON.stringify(input.features) : null,
        input.status ?? 'active',
        input.sortOrder ?? 0,
        existing.id,
      ],
    );
    return existing;
  }
  const id = createId('pln');
  db.run(
    `INSERT INTO plans
       (id, key, name, description, price_cents, currency, billing_interval, monthly_credits, max_agents, max_workspaces, max_seats, max_usage_per_day, features, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.key,
      input.name,
      input.description ?? null,
      input.priceCents ?? 0,
      input.currency ?? 'PKR',
      input.billingInterval ?? 'month',
      input.monthlyCredits ?? 0,
      input.maxAgents ?? 3,
      input.maxWorkspaces ?? 1,
      input.maxSeats ?? 1,
      input.maxUsagePerDay ?? 0,
      input.features ? JSON.stringify(input.features) : null,
      input.status ?? 'active',
      input.sortOrder ?? 0,
      now,
      now,
    ],
  );
  return { id };
}

export function listPlans(): PlanRow[] {
  return db.all<PlanRow>('SELECT * FROM plans WHERE status = ? ORDER BY sort_order ASC', ['active']);
}

export function getPlanByKey(key: string): PlanRow | undefined {
  return db.get<PlanRow>('SELECT * FROM plans WHERE key = ?', [key]);
}

/**
 * Idempotently create the base pricing plan catalog.
 * Prices are in PKR cents (100 PKR = 10000 cents).
 */
export function ensureBootstrapPlans(): void {
  upsertPlan({
    key: 'free',
    name: 'Free Trial',
    description: '30-day trial with 5 free tasks.',
    priceCents: 0,
    currency: 'PKR',
    monthlyCredits: 5,
    maxAgents: 3,
    maxWorkspaces: 1,
    maxSeats: 1,
    features: { trialDays: 30, freeTasks: 5, customCredits: false },
    sortOrder: 0,
  });
  upsertPlan({
    key: 'pro',
    name: 'AKBARAL Pro',
    description: 'Unlimited core agent usage with monthly credit allowance.',
    priceCents: 499900, // 4,999 PKR per month
    currency: 'PKR',
    monthlyCredits: 100,
    maxAgents: 50,
    maxWorkspaces: 5,
    maxSeats: 3,
    features: { agentWorld: true, agentFactory: true, customCredits: true, apiAccess: true },
    sortOrder: 10,
  });
  upsertPlan({
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Company-grade workspaces, customization and support.',
    priceCents: 4999900, // 49,999 PKR per month
    currency: 'PKR',
    monthlyCredits: 2000,
    maxAgents: 10000,
    maxWorkspaces: 100,
    maxSeats: 100,
    features: { sso: true, dedicated: true, team: true, customCredits: true, apiAccess: true, sla: true },
    sortOrder: 20,
  });
}

export function createSubscription(input: {
  userId: string;
  planKey: string;
  status?: string;
  billingProvider?: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  trialDays?: number;
  seats?: number;
}): { id: string } {
  const plan = getPlanByKey(input.planKey);
  if (!plan) {
    throw new Error(`plan ${input.planKey} does not exist`);
  }
  const id = createId('sub');
  const now = NOW();
  const trialDays = input.trialDays ?? FREE_TRIAL_DAYS;
  const trialEnds = newDate(trialDays);
  db.run(
    `INSERT INTO subscriptions
       (id, user_id, plan_id, status, starts_at, trial_ends_at, current_period_start, current_period_end, billing_provider, provider_customer_id, provider_subscription_id, seats, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      plan.id,
      input.status ?? 'trialing',
      now,
      trialEnds,
      now,
      newDate(trialDays + 30),
      input.billingProvider ?? 'manual',
      input.providerCustomerId ?? null,
      input.providerSubscriptionId ?? null,
      input.seats ?? 1,
      now,
      now,
    ],
  );
  return { id };
}

export function cancelActiveSubscriptions(userId: string): void {
  db.run(
    `UPDATE subscriptions
     SET status = 'cancelled', updated_at = ?, cancel_at_period_end = 1
     WHERE user_id = ? AND status IN ('trialing','active')`,
    [NOW(), userId],
  );
}

export function getActiveSubscription(userId: string): Record<string, unknown> | undefined {
  return db.get(
    `SELECT s.*, p.key AS plan_key, p.name AS plan_name, p.price_cents, p.currency, p.monthly_credits
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = ? AND s.status IN ('trialing','active')
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId],
  ) as Record<string, unknown> | undefined;
}

export interface EntitlementRow {
  feature: string;
  value: string | null;
  enabled: number;
}

export function ensureEntitlement(userId: string, feature: string, value?: string | null, enabled = true): void {
  const existing = db.get<{ id: string }>(
    'SELECT id FROM entitlements WHERE user_id = ? AND feature = ?',
    [userId, feature],
  );
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE entitlements SET value = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      [value ?? null, enabled ? 1 : 0, now, existing.id],
    );
    return;
  }
  const id = createId('ent');
  db.run(
    `INSERT INTO entitlements (id, user_id, feature, value, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, feature, value ?? null, enabled ? 1 : 0, now, now],
  );
}

export function getEntitlements(userId: string): EntitlementRow[] {
  return db.all<EntitlementRow>('SELECT feature, value, enabled FROM entitlements WHERE user_id = ?', [userId]);
}

export function grantCustomCredits(input: {
  userId: string;
  amount: number;
  reference?: string;
  reason?: string;
}): { id: string } {
  const id = createId('crx');
  const account = db.get<{ free_credits: number; paid_credits: number }>(
    'SELECT free_credits, paid_credits FROM credit_accounts WHERE user_id = ?',
    [input.userId],
  );
  const nextPaid = (account?.paid_credits ?? 0) + input.amount;
  const now = NOW();
  db.transaction((tx) => {
    tx.run(
      `UPDATE credit_accounts SET paid_credits = ?, last_credit_at = ? WHERE user_id = ?`,
      [nextPaid, now, input.userId],
    );
    tx.run(
      `INSERT INTO credit_transactions (id, type, amount, balance_after, user_id, reason, status, reference, created_at)
       VALUES (?, 'grant', ?, ?, ?, ?, 'completed', ?, ?)`,
      [id, input.amount, nextPaid, input.userId, input.reason ?? 'custom credit purchase', input.reference ?? null, now],
    );
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Invoices / payments / billing events
// ---------------------------------------------------------------------------

export function createInvoice(input: {
  userId: string;
  subscriptionId?: string | null;
  amountCents: number;
  currency?: string;
  provider?: string;
  lineItems?: Array<{ description: string; amountCents: number }>;
  status?: string;
  dueAt?: string | null;
}): { id: string; number: string } {
  const id = createId('inv');
  const number = `AKB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const now = NOW();
  db.run(
    `INSERT INTO invoices (id, user_id, subscription_id, number, status, subtotal_cents, total_cents, currency, line_items, provider, due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.subscriptionId ?? null,
      number,
      input.status ?? 'due',
      input.amountCents,
      input.amountCents,
      input.currency ?? 'PKR',
      input.lineItems ? JSON.stringify(input.lineItems) : null,
      input.provider ?? 'manual',
      input.dueAt ?? now,
      now,
      now,
    ],
  );
  return { id, number };
}

export function markInvoicePaid(invoiceId: string, paidAt?: string): void {
  db.run('UPDATE invoices SET status = ?, paid_at = COALESCE(?, paid_at) WHERE id = ?', ['paid', paidAt ?? NOW(), invoiceId]);
}

export function createPayment(input: {
  userId: string;
  invoiceId?: string | null;
  provider?: string;
  status?: string;
  amountCents: number;
  currency?: string;
  providerPaymentId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  processedAt?: string | null;
}): { id: string } {
  const id = createId('pay');
  db.run(
    `INSERT INTO payments
       (id, user_id, invoice_id, provider, provider_payment_id, status, amount_cents, currency, failure_code, failure_reason, processed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.invoiceId ?? null,
      input.provider ?? 'manual',
      input.providerPaymentId ?? null,
      input.status ?? 'pending',
      input.amountCents,
      input.currency ?? 'PKR',
      input.failureCode ?? null,
      input.failureReason ?? null,
      input.processedAt ?? null,
      NOW(),
    ],
  );
  return { id };
}

export function listInvoicesForUser(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC', [userId]) as Array<Record<string, unknown>>;
}

export function listPaymentsForUser(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC', [userId]) as Array<Record<string, unknown>>;
}

export function recordBillingEvent(input: {
  userId?: string | null;
  eventType: string;
  provider?: string;
  payload?: Record<string, unknown>;
}): { id: string } {
  const id = createId('bil');
  db.run(
    `INSERT INTO billing_events (id, user_id, event_type, provider, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId ?? null,
      input.eventType,
      input.provider ?? 'manual',
      input.payload ? JSON.stringify(input.payload) : null,
      NOW(),
    ],
  );
  return { id };
}

// ---------------------------------------------------------------------------
// Workflows / task graph
// ---------------------------------------------------------------------------

export function createWorkflow(input: { userId: string; goal: string; projectId?: string | null; intent?: string; plan?: unknown }): { id: string } {
  const id = createId('wfl');
  const now = NOW();
  db.run(
    `INSERT INTO workflows (id, project_id, user_id, goal, intent, status, plan_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?)`,
    [id, input.projectId ?? null, input.userId, input.goal, input.intent ?? null, input.plan ? JSON.stringify(input.plan) : null, now, now],
  );
  return { id };
}

export function updateWorkflowStatus(input: { id: string; status: string; result?: unknown; errorMessage?: string | null; completedAt?: string | null; expectedStatuses?: string[] }): boolean {
  const guardSql = input.expectedStatuses
    ? ` AND status IN (${input.expectedStatuses.map(() => '?').join(',')})`
    : '';
  const result = db.run(
    `UPDATE workflows SET status=?, result_json=?, error_message=?, completed_at=COALESCE(?, completed_at) WHERE id=?${guardSql}`,
    [
      input.status,
      input.result ? JSON.stringify(input.result) : null,
      input.errorMessage ?? null,
      input.completedAt ?? null,
      input.id,
      ...(input.expectedStatuses ?? []),
    ],
  );
  return result.changes === 1;
}

export function getWorkflow(id: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM workflows WHERE id = ?', [id]) as Record<string, unknown> | undefined;
}

export function createWorkflowStep(input: {
  workflowId: string;
  taskId?: string | null;
  agentId?: string | null;
  modelKey?: string | null;
  toolKey?: string | null;
  stepOrder: number;
  dependsOn?: string[];
}): { id: string } {
  const id = createId('stp');
  db.run(
    `INSERT INTO workflow_steps (id, workflow_id, task_id, agent_id, model_key, tool_key, step_order, depends_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.workflowId,
      input.taskId ?? null,
      input.agentId ?? null,
      input.modelKey ?? null,
      input.toolKey ?? null,
      input.stepOrder,
      input.dependsOn ? input.dependsOn.join(',') : null,
      NOW(),
      NOW(),
    ],
  );
  return { id };
}

export function updateWorkflowStepStatus(input: { id: string; status: string; result?: unknown; errorMessage?: string | null; completedAt?: string | null; taskId?: string | null }): void {
  if (input.taskId !== undefined && input.taskId !== null) {
    db.run(`UPDATE workflow_steps SET task_id=? WHERE id=?`, [input.taskId, input.id]);
  }
  db.run(
    `UPDATE workflow_steps SET status=?, result_json=?, error_message=?, completed_at=COALESCE(?, completed_at) WHERE id=?`,
    [input.status, input.result ? JSON.stringify(input.result) : null, input.errorMessage ?? null, input.completedAt ?? null, input.id],
  );
}

export function listWorkflowSteps(workflowId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC', [workflowId]) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Agent registry versioning / marketplace / saves
// ---------------------------------------------------------------------------

export interface AgentDefinitionRow {
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

export function findAgentCategoryBySlug(slug: string): { id: string } | undefined {
  return db.get<{ id: string }>('SELECT id FROM agent_categories WHERE slug = ?', [slug]);
}

export function upsertAgentCategory(input: { name: string; slug: string; description?: string | null; icon?: string | null }): { id: string } {
  const existing = findAgentCategoryBySlug(input.slug);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE agent_categories SET name=?, description=?, icon=?, updated_at=? WHERE id=?`,
      [input.name, input.description ?? null, input.icon ?? null, now, existing.id],
    );
    return existing;
  }
  const id = createId('cat');
  db.run(
    `INSERT INTO agent_categories (id, name, slug, description, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.slug, input.description ?? null, input.icon ?? null, now, now],
  );
  return { id };
}

export function upsertAgent(input: {
  name: string;
  slug: string;
  description?: string | null;
  version?: string;
  categoryId?: string | null;
  ownerId?: string | null;
  config?: Record<string, unknown> | null;
  status?: string;
}): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM agents WHERE slug = ?', [input.slug]);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE agents SET name=?, description=?, version=?, category_id=?, owner_id=?, status=?, config=?, updated_at=? WHERE id=?`,
      [
        input.name,
        input.description ?? null,
        input.version ?? '1.0.0',
        input.categoryId ?? null,
        input.ownerId ?? null,
        input.status ?? 'active',
        input.config ? JSON.stringify(input.config) : null,
        now,
        existing.id,
      ],
    );
    return existing;
  }
  const id = createId('agt');
  db.run(
    `INSERT INTO agents
       (id, name, slug, description, version, category_id, runtime, status, owner_id, project_id, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'node', ?, ?, NULL, ?, ?, ?)`,
    [
      id,
      input.name,
      input.slug,
      input.description ?? null,
      input.version ?? '1.0.0',
      input.categoryId ?? null,
      input.status ?? 'active',
      input.ownerId ?? null,
      input.config ? JSON.stringify(input.config) : null,
      now,
      now,
    ],
  );
  return { id };
}

export function insertAgentVersion(input: { agentId: string; version: string; definition: unknown; checksum: string; status?: string; createdBy?: string | null; changelog?: string | null }): { id: string } {
  const id = createId('avr');
  db.run(
    `INSERT INTO agent_versions (id, agent_id, version, definition, checksum, status, created_by_user_id, changelog, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agentId,
      input.version,
      JSON.stringify(input.definition),
      input.checksum,
      input.status ?? 'active',
      input.createdBy ?? null,
      input.changelog ?? null,
      NOW(),
    ],
  );
  return { id };
}

export function getLatestAgentVersion(agentId: string): Record<string, unknown> | undefined {
  return db.get(
    'SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1',
    [agentId],
  ) as Record<string, unknown> | undefined;
}

export function upsertAgentMarketplace(input: {
  agentId: string;
  publisherUserId?: string | null;
  priceCents?: number;
  currency?: string;
  status?: string;
  tags?: string[];
}): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM agent_marketplace WHERE agent_id = ?', [input.agentId]);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE agent_marketplace SET publisher_user_id=?, price_cents=?, currency=?, status=?, tags=?, updated_at=? WHERE agent_id=?`,
      [
        input.publisherUserId ?? null,
        input.priceCents ?? 0,
        input.currency ?? 'PKR',
        input.status ?? 'draft',
        input.tags ? JSON.stringify(input.tags) : null,
        now,
        input.agentId,
      ],
    );
    return existing;
  }
  const id = createId('mkt');
  db.run(
    `INSERT INTO agent_marketplace (id, agent_id, publisher_user_id, price_cents, currency, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agentId,
      input.publisherUserId ?? null,
      input.priceCents ?? 0,
      input.currency ?? 'PKR',
      input.status ?? 'draft',
      input.tags ? JSON.stringify(input.tags) : null,
      now,
      now,
    ],
  );
  return { id };
}

export function listMarketplaceAgents(filter?: { status?: string; ownerUserId?: string }): Array<Record<string, unknown>> {
  const clauses: string[] = [];
  const params: Array<string | number | bigint | null | Uint8Array> = [];
  if (filter?.status) {
    clauses.push('m.status = ?');
    params.push(filter.status);
  }
  if (filter?.ownerUserId) {
    clauses.push('a.owner_id = ?');
    params.push(filter.ownerUserId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.all(
    `SELECT a.id, a.slug, a.name, a.description, a.version, a.status AS agent_status, a.owner_id, a.created_at,
            m.price_cents, m.currency, m.status AS marketplace_status, m.rating, m.review_count, m.install_count, m.tags
     FROM agent_marketplace m JOIN agents a ON a.id = m.agent_id
     ${where}
     ORDER BY m.created_at DESC`,
    params,
  ) as Array<Record<string, unknown>>;
}

export function createAgentOrder(input: { userId: string; agentId: string; amountCents: number; currency?: string }): { id: string } {
  const id = createId('ord');
  db.run(
    `INSERT INTO agent_orders (id, user_id, agent_id, amount_cents, currency, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
    [id, input.userId, input.agentId, input.amountCents, input.currency ?? 'PKR', NOW()],
  );
  db.run('UPDATE agent_marketplace SET install_count = install_count + 1 WHERE agent_id = ?', [input.agentId]);
  return { id };
}

export function findAllUserAgents(userId: string, agentId?: string): Array<Record<string, unknown>> {
  if (agentId) {
    return db.all(
      'SELECT * FROM user_agents WHERE user_id = ? AND agent_id = ?',
      [userId, agentId],
    ) as Array<Record<string, unknown>>;
  }
  return db.all('SELECT * FROM user_agents WHERE user_id = ?', [userId]) as Array<Record<string, unknown>>;
}

export function saveUserAgent(input: { userId: string; agentId: string; saved?: boolean; favorite?: boolean }): void {
  db.run(
    `INSERT INTO user_agents (id, user_id, agent_id, saved, favorite, installed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, agent_id) DO UPDATE SET saved=?, favorite=?`,
    [createId('ua'), input.userId, input.agentId, input.saved ? 1 : 0, input.favorite ? 1 : 0, NOW(), input.saved ? 1 : 0, input.favorite ? 1 : 0],
  );
}

export function updateAgentStatus(agentId: string, status: string, version?: string): void {
  db.run(
    `UPDATE agents SET status = ?, version = COALESCE(?, version), updated_at = ? WHERE id = ?`,
    [status, version ?? null, NOW(), agentId],
  );
}

export function updateAgentConfig(agentId: string, config: Record<string, unknown>): void {
  db.run(
    `UPDATE agents SET config = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(config), NOW(), agentId],
  );
}

export function findAgentById(id: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM agents WHERE id = ?', [id]) as Record<string, unknown> | undefined;
}

export function listAgentVersions(agentId: string, limit = 50): Array<Record<string, unknown>> {
  return db.all(
    'SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    [agentId, limit],
  ) as Array<Record<string, unknown>>;
}

export function listAuditLogs(limit = 200): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]) as Array<Record<string, unknown>>;
}

export function recordSecurityEvent(input: {
  userId?: string | null;
  eventType: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('sec');
  db.run(
    `INSERT INTO security_logs (id, user_id, event_type, severity, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId ?? null, input.eventType, input.severity, input.message, input.metadata ? JSON.stringify(input.metadata) : null, NOW()],
  );
  return { id };
}

// ---------------------------------------------------------------------------
// Model registry / providers / runs
// ---------------------------------------------------------------------------

export function upsertModelProvider(input: {
  key: string;
  name: string;
  type?: string;
  baseUrl?: string | null;
  docsUrl?: string | null;
  envKey?: string | null;
  capabilities?: string[];
  status?: string;
}): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM model_providers WHERE key = ?', [input.key]);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE model_providers SET name=?, type=?, base_url=?, docs_url=?, env_key=?, capabilities=?, status=? WHERE id=?`,
      [
        input.name,
        input.type ?? 'llm',
        input.baseUrl ?? null,
        input.docsUrl ?? null,
        input.envKey ?? null,
        input.capabilities ? input.capabilities.join(',') : null,
        input.status ?? 'disabled',
        existing.id,
      ],
    );
    return existing;
  }
  const id = createId('mvp');
  db.run(
    `INSERT INTO model_providers (id, key, name, type, base_url, docs_url, auth_type, env_key, status, capabilities, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'bearer', ?, ?, ?, ?, ?)`,
    [
      id,
      input.key,
      input.name,
      input.type ?? 'llm',
      input.baseUrl ?? null,
      input.docsUrl ?? null,
      input.envKey ?? null,
      input.status ?? 'disabled',
      input.capabilities ? input.capabilities.join(',') : null,
      now,
      now,
    ],
  );
  return { id };
}

export function upsertModel(input: {
  key: string;
  name: string;
  providerKey: string;
  capability?: string;
  modality?: string;
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  costInputPerMillionCents?: number;
  costOutputPerMillionCents?: number;
  costPerImageCents?: number;
  latencyMs?: number;
  reliability?: number;
  strengths?: string[];
  weaknesses?: string[];
  status?: string;
  isDefault?: boolean;
}): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM models WHERE key = ?', [input.key]);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE models SET name=?, provider_key=?, capability=?, modality=?, context_tokens=?, max_output_tokens=?,
        cost_input_per_million_cents=?, cost_output_per_million_cents=?, cost_per_image_cents=?, latency_ms=?, reliability=?,
        strengths=?, weaknesses=?, status=?, is_default=? WHERE id=?`,
      [
        input.name,
        input.providerKey,
        input.capability ?? 'llm',
        input.modality ?? 'text',
        input.contextTokens ?? null,
        input.maxOutputTokens ?? null,
        input.costInputPerMillionCents ?? 0,
        input.costOutputPerMillionCents ?? 0,
        input.costPerImageCents ?? 0,
        input.latencyMs ?? 0,
        input.reliability ?? 0.95,
        input.strengths ? JSON.stringify(input.strengths) : null,
        input.weaknesses ? JSON.stringify(input.weaknesses) : null,
        input.status ?? 'disabled',
        input.isDefault ? 1 : 0,
        existing.id,
      ],
    );
    return existing;
  }
  const id = createId('mdl');
  db.run(
    `INSERT INTO models
       (id, key, name, provider_key, capability, modality, context_tokens, max_output_tokens, cost_input_per_million_cents, cost_output_per_million_cents, cost_per_image_cents, latency_ms, reliability, strengths, weaknesses, status, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.key,
      input.name,
      input.providerKey,
      input.capability ?? 'llm',
      input.modality ?? 'text',
      input.contextTokens ?? null,
      input.maxOutputTokens ?? null,
      input.costInputPerMillionCents ?? 0,
      input.costOutputPerMillionCents ?? 0,
      input.costPerImageCents ?? 0,
      input.latencyMs ?? 0,
      input.reliability ?? 0.95,
      input.strengths ? JSON.stringify(input.strengths) : null,
      input.weaknesses ? JSON.stringify(input.weaknesses) : null,
      input.status ?? 'disabled',
      input.isDefault ? 1 : 0,
      now,
      now,
    ],
  );
  return { id };
}

export function listModels(): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM models ORDER BY sort_order ASC, name ASC') as Array<Record<string, unknown>>;
}

export function getModel(key: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM models WHERE key = ?', [key]) as Record<string, unknown> | undefined;
}

export function listEnabledProviders(): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM model_providers ORDER BY name ASC') as Array<Record<string, unknown>>;
}

export function recordModelRun(input: {
  modelKey: string;
  taskId?: string | null;
  agentExecutionId?: string | null;
  providerKey?: string | null;
  status?: string;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costCents?: number | null;
  errorMessage?: string | null;
}): { id: string } {
  const id = createId('mrun');
  db.run(
    `INSERT INTO model_runs
       (id, model_key, task_id, agent_execution_id, provider_key, status, latency_ms, input_tokens, output_tokens, cost_cents, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.modelKey,
      input.taskId ?? null,
      input.agentExecutionId ?? null,
      input.providerKey ?? null,
      input.status ?? 'pending',
      input.latencyMs ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.costCents ?? null,
      input.errorMessage ?? null,
      NOW(),
      NOW(),
    ],
  );
  return { id };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function registerTool(input: {
  key: string;
  name: string;
  description?: string | null;
  kind?: string;
  inputSchema?: unknown | null;
  outputSchema?: unknown | null;
  securityPermissions?: string[];
  requiresCredential?: boolean;
  requiredCredentialEnvKey?: string | null;
  supportsStreaming?: boolean;
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const existing = db.get<{ id: string }>('SELECT id FROM tools WHERE key = ?', [input.key]);
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE tools SET name=?, description=?, kind=?, input_schema=?, output_schema=?, security_permissions=?, requires_credential=?, required_credential_env_key=?, supports_streaming=?, metadata=?, updated_at=? WHERE id=?`,
      [
        input.name,
        input.description ?? null,
        input.kind ?? 'knowledge',
        input.inputSchema ? JSON.stringify(input.inputSchema) : null,
        input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        input.securityPermissions ? JSON.stringify(input.securityPermissions) : null,
        input.requiresCredential ? 1 : 0,
        input.requiredCredentialEnvKey ?? null,
        input.supportsStreaming ? 1 : 0,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        existing.id,
      ],
    );
    return existing;
  }
  const id = createId('tls');
  db.run(
    `INSERT INTO tools
       (id, key, name, description, kind, input_schema, output_schema, security_permissions, requires_credential, required_credential_env_key, supports_streaming, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      id,
      input.key,
      input.name,
      input.description ?? null,
      input.kind ?? 'knowledge',
      input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      input.outputSchema ? JSON.stringify(input.outputSchema) : null,
      input.securityPermissions ? JSON.stringify(input.securityPermissions) : null,
      input.requiresCredential ? 1 : 0,
      input.requiredCredentialEnvKey ?? null,
      input.supportsStreaming ? 1 : 0,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ],
  );
  return { id };
}

export function linkAgentTool(input: { agentId: string; toolKey: string; permission?: string; config?: unknown }): void {
  const tool = db.get<{ id: string }>('SELECT id FROM tools WHERE key = ?', [input.toolKey]);
  if (!tool) {
    return;
  }
  db.run(
    `INSERT INTO agent_tools (agent_id, tool_id, permission, config, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id, tool_id) DO UPDATE SET permission=?, config=?`,
    [input.agentId, tool.id, input.permission ?? 'read', input.config ? JSON.stringify(input.config) : null, NOW(), input.permission ?? 'read', input.config ? JSON.stringify(input.config) : null],
  );
}

export function listAgentTools(agentId: string): Array<Record<string, unknown>> {
  return db.all(
    `SELECT t.key, t.name, t.kind, at.permission, at.config
     FROM agent_tools at JOIN tools t ON t.id = at.tool_id
     WHERE at.agent_id = ?`,
    [agentId],
  ) as Array<Record<string, unknown>>;
}

export function findProjectById(id: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM projects WHERE id = ?', [id]) as Record<string, unknown> | undefined;
}

export function listProjectsByUser(userId: string): Array<Record<string, unknown>> {
  const owned = db.all('SELECT *, ? AS my_role FROM projects WHERE owner_id = ?', ['owner', userId]) as Array<Record<string, unknown>>;
  const memberOf = db.all(
    `SELECT p.*, wm.role AS my_role
     FROM workspace_members wm
     JOIN projects p ON p.id = wm.project_id
     WHERE wm.user_id = ?
     ORDER BY p.created_at DESC`,
    [userId],
  ) as Array<Record<string, unknown>>;
  const seen = new Set(owned.map((project) => String(project.id)));
  return [...owned, ...memberOf.filter((project) => !seen.has(String(project.id)))];
}

// ---------------------------------------------------------------------------
// Files / knowledge
// ---------------------------------------------------------------------------

export function createFile(input: {
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  originalName: string;
  storageKey: string;
  mimeType?: string | null;
  sizeBytes: number;
  sha256?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}): { id: string } {
  const id = createId('fil');
  const now = NOW();
  db.run(
    `INSERT INTO files
       (id, project_id, user_id, task_id, original_name, storage_key, mime_type, size_bytes, sha256, kind, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
    [
      id,
      input.projectId ?? null,
      input.userId,
      input.taskId ?? null,
      input.originalName,
      input.storageKey,
      input.mimeType ?? null,
      input.sizeBytes,
      input.sha256 ?? null,
      input.kind ?? 'document',
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ],
  );
  return { id };
}

export function createFileVersion(input: { fileId: string; storageKey: string; sizeBytes: number }): void {
  const row = db.get<{ version: number }>('SELECT COALESCE(MAX(version), 0) AS version FROM file_versions WHERE file_id = ?', [input.fileId]);
  const version = (row?.version ?? 0) + 1;
  db.run('INSERT INTO file_versions (id, file_id, version, storage_key, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    createId('fver'),
    input.fileId,
    version,
    input.storageKey,
    input.sizeBytes,
    NOW(),
  ]);
}

export function getFile(id: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM files WHERE id = ?', [id]) as Record<string, unknown> | undefined;
}

export function listProjectFiles(projectId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC', [projectId]) as Array<Record<string, unknown>>;
}

export function indexKnowledgeItem(input: {
  userId: string;
  projectId?: string | null;
  fileId?: string | null;
  sourceType?: string;
  title: string;
  content: string;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
}): { id: string } {
  const id = createId('kno');
  const contentHash = createHash('sha256').update(input.content).digest('hex');
  db.run(
    `INSERT INTO knowledge_items
       (id, project_id, user_id, file_id, source_type, title, content, content_hash, mime_type, metadata, indexed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectId ?? null,
      input.userId,
      input.fileId ?? null,
      input.sourceType ?? 'document',
      input.title,
      input.content,
      contentHash,
      input.mimeType ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      NOW(),
      NOW(),
    ],
  );
  const row = db.get<{ rowid: number }>('SELECT rowid FROM knowledge_items WHERE id = ?', [id]);
  if (row) {
    // Guard against a stale FTS row that may reuse this rowid after the
    // underlying knowledge_item was removed by a cascade before the cleanup
    // trigger was created. Removing it first keeps the FTS mirror idempotent.
    db.run('DELETE FROM knowledge_fts WHERE rowid = ?', [row.rowid]);
    db.run('INSERT INTO knowledge_fts(rowid, content) VALUES (?, ?)', [row.rowid, input.content]);
  }
  return { id };
}

export function searchKnowledge(userId: string, query: string, limit = 20, projectId?: string): Array<Record<string, unknown>> {
  const projectFilter = projectId ? ' AND ki.project_id = ?' : '';
  return db.all(
    `SELECT ki.id, ki.title, ki.content, ki.source_type, ki.mime_type, ki.project_id
     FROM knowledge_fts fts
     JOIN knowledge_items ki ON ki.rowid = fts.rowid
     WHERE knowledge_fts MATCH ? AND ki.user_id = ?${projectFilter}
     ORDER BY ki.indexed_at DESC
     LIMIT ?`,
    projectId ? [query, userId, projectId, limit] : [query, userId, limit],
  ) as Array<Record<string, unknown>>;
}

/**
 * Project-scoped knowledge search for shared workspaces: searches every
 * knowledge item in the project regardless of which member indexed it.
 * Access control happens at the route layer (workspace membership required).
 */
export function searchProjectKnowledge(projectId: string, query: string, limit = 20): Array<Record<string, unknown>> {
  return db.all(
    `SELECT ki.id, ki.title, ki.content, ki.source_type, ki.mime_type, ki.project_id, ki.user_id
     FROM knowledge_fts fts
     JOIN knowledge_items ki ON ki.rowid = fts.rowid
     WHERE knowledge_fts MATCH ? AND ki.project_id = ?
     ORDER BY ki.indexed_at DESC
     LIMIT ?`,
    [query, projectId, limit],
  ) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Workspace membership (project-scoped authorization)
// ---------------------------------------------------------------------------

export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer';

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export function projectRole(project: { id: string; owner_id: string | Buffer }, userId: string): ProjectRole | null {
  if (String(project.owner_id) === userId) {
    return 'owner';
  }
  const row = db.get<{ role: string }>(
    'SELECT role FROM workspace_members WHERE project_id = ? AND user_id = ?',
    [project.id, userId],
  );
  return (row?.role as ProjectRole) ?? null;
}

export function hasProjectRole(project: { id: string; owner_id: string | Buffer }, userId: string, minimum: ProjectRole): boolean {
  const role = projectRole(project, userId);
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function listProjectMembers(projectId: string): Array<Record<string, unknown>> {
  const members = db.all(
    `SELECT wm.user_id, u.email, u.name, wm.role, wm.invited_at
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.project_id = ?
     ORDER BY wm.invited_at ASC`,
    [projectId],
  ) as Array<Record<string, unknown>>;
  const owner = db.get<{ id: string; email: string; name: string; created_at: string }>(
    `SELECT u.id, u.email, u.name, p.created_at FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`,
    [projectId],
  );
  const rows: Array<Record<string, unknown>> = [];
  if (owner) {
    rows.push({ user_id: owner.id, email: owner.email, name: owner.name, role: 'owner', invited_at: owner.created_at });
  }
  return [...rows, ...members];
}

export function addProjectMember(input: { projectId: string; userId: string; role: ProjectRole }): void {
  db.run(
    `INSERT INTO workspace_members (id, project_id, user_id, role, invited_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    [createId('wsm'), input.projectId, input.userId, input.role, NOW()],
  );
}

export function updateProjectMemberRole(projectId: string, userId: string, role: ProjectRole): boolean {
  const result = db.run(
    'UPDATE workspace_members SET role = ? WHERE project_id = ? AND user_id = ?',
    [role, projectId, userId],
  );
  return result.changes === 1;
}

export function removeProjectMember(projectId: string, userId: string): boolean {
  const result = db.run(
    'DELETE FROM workspace_members WHERE project_id = ? AND user_id = ?',
    [projectId, userId],
  );
  return result.changes === 1;
}

export function listFilesByProject(projectId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC', [projectId]) as Array<Record<string, unknown>>;
}

export function listProjectArtifacts(projectId: string): Array<Record<string, unknown>> {
  return db.all(
    `SELECT * FROM files WHERE project_id = ? AND kind = 'artifact' ORDER BY created_at DESC`,
    [projectId],
  ) as Array<Record<string, unknown>>;
}

export function listTaskFiles(taskId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM files WHERE task_id = ? ORDER BY created_at ASC', [taskId]) as Array<Record<string, unknown>>;
}

export function attachFileToTask(fileId: string, taskId: string | null): boolean {
  const result = db.run('UPDATE files SET task_id = ?, updated_at = ? WHERE id = ?', [taskId, NOW(), fileId]);
  return result.changes === 1;
}

// ---------------------------------------------------------------------------
// Notifications, analytics, admin, feature flags, metrics
// ---------------------------------------------------------------------------

export function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  delivered?: boolean;
}): { id: string } {
  const id = createId('ntf');
  db.run(
    `INSERT INTO notifications (id, user_id, type, title, body, data, delivered_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.type, input.title, input.body ?? null, input.data ? JSON.stringify(input.data) : null, input.delivered ? NOW() : null, NOW()],
  );
  return { id };
}

export function listNotifications(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [userId]) as Array<Record<string, unknown>>;
}

export function markNotificationRead(notificationId: string, userId: string): void {
  db.run(
    `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?`,
    [notificationId, userId],
  );
}

export function recordAnalyticsEvent(input: {
  userId?: string | null;
  projectId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
  sessionId?: string | null;
}): { id: string } {
  const id = createId('ana');
  db.run(
    `INSERT INTO analytics_events (id, user_id, project_id, event_type, payload, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId ?? null, input.projectId ?? null, input.eventType, input.payload ? JSON.stringify(input.payload) : null, input.sessionId ?? null, NOW()],
  );
  return { id };
}

export function recordSystemMetric(metric: string, value: number, labels?: Record<string, unknown>): void {
  db.run(
    `INSERT INTO system_metrics (id, metric, value, labels, recorded_at) VALUES (?, ?, ?, ?, ?)`,
    [createId('met'), metric, value, labels ? JSON.stringify(labels) : null, NOW()],
  );
}

export function logAdminAction(input: { actorUserId: string; action: string; targetType?: string; targetId?: string; payload?: Record<string, unknown> }): { id: string } {
  const id = createId('adm');
  db.run(
    `INSERT INTO admin_actions (id, actor_user_id, action, target_type, target_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.actorUserId, input.action, input.targetType ?? null, input.targetId ?? null, input.payload ? JSON.stringify(input.payload) : null, NOW()],
  );
  return { id };
}

export function setFeatureFlag(input: { key: string; value?: string | null; description?: string | null; enabled?: boolean }): void {
  const existing = db.get<{ id: string }>('SELECT id FROM feature_flags WHERE key = ?', [input.key]);
  if (existing) {
    db.run('UPDATE feature_flags SET value=?, description=?, enabled=?, updated_at=? WHERE id=?', [
      input.value ?? null,
      input.description ?? null,
      input.enabled ? 1 : 0,
      NOW(),
      existing.id,
    ]);
    return;
  }
  db.run(
    `INSERT INTO feature_flags (id, key, value, description, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [createId('ff'), input.key, input.value ?? null, input.description ?? null, input.enabled ? 1 : 0, NOW(), NOW()],
  );
}

export function listFeatureFlags(): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM feature_flags ORDER BY key') as Array<Record<string, unknown>>;
}

export function isFeatureFlagEnabled(key: string): boolean {
  const row = db.get<{ enabled: number }>('SELECT enabled FROM feature_flags WHERE key = ?', [key]);
  return Boolean(row && Number(row.enabled) === 1);
}
