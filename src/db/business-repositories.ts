import { createHash, randomBytes } from 'node:crypto';
import { db, createId } from './index';

const NOW = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Auth tokens (password reset / email verification)
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthToken(input: { userId: string; purpose: 'password_reset' | 'email_verify' | 'oauth_state'; ttlMs?: number; ip?: string | null }): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? 60 * 60 * 1000)).toISOString();
  db.run(
    `INSERT INTO auth_tokens (id, user_id, token_hash, purpose, expires_at, issued_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [createId('tok'), input.userId, tokenHash, input.purpose, expiresAt, input.ip ?? null, NOW()],
  );
  return { token, expiresAt };
}

export function verifyAuthToken(token: string, purpose: 'password_reset' | 'email_verify' | 'oauth_state'): { userId: string; tokenId: string } | undefined {
  const row = db.get<{ id: string; user_id: string; expires_at: string; consumed_at: string | null }>(
    'SELECT id, user_id, expires_at, consumed_at FROM auth_tokens WHERE token_hash = ? AND purpose = ?',
    [hashToken(token), purpose],
  );
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
    return undefined;
  }
  return { userId: row.user_id, tokenId: row.id };
}

export function consumeAuthToken(tokenId: string): void {
  db.run('UPDATE auth_tokens SET consumed_at = ? WHERE id = ?', [NOW(), tokenId]);
}

export function markEmailVerified(userId: string): void {
  db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', [NOW(), userId]);
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export function createCrmContact(input: {
  userId: string;
  projectId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
  source?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('cnt');
  db.run(
    `INSERT INTO crm_contacts (id, user_id, project_id, first_name, last_name, email, phone, company, title, source, tags, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.projectId ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.company ?? null,
      input.title ?? null,
      input.source ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      NOW(),
      NOW(),
    ],
  );
  return { id };
}

export function listCrmContacts(userId: string, limit = 200): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM crm_contacts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]) as Array<Record<string, unknown>>;
}

export function createCrmPipeline(input: { userId: string; name: string; description?: string | null; stages?: string[] }): { id: string } {
  const id = createId('pip');
  db.run(
    `INSERT INTO crm_pipelines (id, user_id, name, description, stages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.name, input.description ?? null, input.stages ? JSON.stringify(input.stages) : null, NOW(), NOW()],
  );
  return { id };
}

export function listCrmPipelines(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM crm_pipelines WHERE user_id = ? ORDER BY created_at DESC', [userId]) as Array<Record<string, unknown>>;
}

export function createCrmDeal(input: {
  userId: string;
  title: string;
  pipelineId?: string | null;
  contactId?: string | null;
  stage?: string;
  amountCents?: number;
  probability?: number;
  metadata?: Record<string, unknown> | null;
}): { id: string } {
  const id = createId('dl');
  db.run(
    `INSERT INTO crm_deals (id, user_id, pipeline_id, contact_id, title, stage, amount_cents, currency, probability, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.pipelineId ?? null,
      input.contactId ?? null,
      input.title,
      input.stage ?? 'new',
      input.amountCents ?? 0,
      input.probability ?? 0,
      input.metadata ? JSON.stringify(input.metadata) : null,
      NOW(),
      NOW(),
    ],
  );
  return { id };
}

export function listCrmDeals(userId: string, pipelineId?: string): Array<Record<string, unknown>> {
  if (pipelineId) {
    return db.all('SELECT * FROM crm_deals WHERE user_id = ? AND pipeline_id = ? ORDER BY updated_at DESC', [userId, pipelineId]) as Array<Record<string, unknown>>;
  }
  return db.all('SELECT * FROM crm_deals WHERE user_id = ? ORDER BY updated_at DESC', [userId]) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Campaigns and automation
// ---------------------------------------------------------------------------

export function createCampaign(input: {
  userId: string;
  name: string;
  type?: string;
  audienceQuery?: string | null;
  scheduleAt?: string | null;
}): { id: string } {
  const id = createId('cmp');
  db.run(
    `INSERT INTO campaigns (id, user_id, name, status, type, audience_query, schedule_at, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    [id, input.userId, input.name, input.type ?? 'email', input.audienceQuery ?? null, input.scheduleAt ?? null, NOW(), NOW()],
  );
  return { id };
}

export function listCampaigns(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC', [userId]) as Array<Record<string, unknown>>;
}

export function updateCampaignStatus(campaignId: string, status: string): void {
  db.run('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', [status, NOW(), campaignId]);
}

export function updateCampaignMessageStatus(id: string, status: 'queued' | 'sent' | 'failed', errorMessage?: string | null): void {
  db.run('UPDATE campaign_messages SET status = ?, error_message = ? WHERE id = ?', [status, errorMessage ?? null, id]);
}

export function queueCampaignMessage(input: {
  campaignId: string;
  userId: string;
  channel: string;
  recipient: string;
  subject?: string | null;
  body: string;
}): { id: string } {
  const id = createId('msg');
  db.run(
    `INSERT INTO campaign_messages (id, campaign_id, user_id, channel, recipient, subject, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [id, input.campaignId, input.userId, input.channel, input.recipient, input.subject ?? null, input.body, NOW()],
  );
  return { id };
}

export function listCampaignMessages(campaignId: string, limit = 500): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?', [campaignId, limit]) as Array<Record<string, unknown>>;
}

export function createAutomation(input: {
  userId: string;
  name: string;
  triggerKey: string;
  condition?: Record<string, unknown> | null;
  steps?: Array<Record<string, unknown>>;
}): { id: string } {
  const id = createId('auto');
  db.run(
    `INSERT INTO automations (id, user_id, name, trigger_key, condition_json, steps_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [id, input.userId, input.name, input.triggerKey, input.condition ? JSON.stringify(input.condition) : null, input.steps ? JSON.stringify(input.steps) : null, NOW(), NOW()],
  );
  return { id };
}

export function listAutomations(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM automations WHERE user_id = ? ORDER BY created_at DESC', [userId]) as Array<Record<string, unknown>>;
}

export function recordAutomationRun(automationId: string): void {
  db.run('UPDATE automations SET run_count = run_count + 1, last_run_at = ? WHERE id = ?', [NOW(), automationId]);
}

// ---------------------------------------------------------------------------
// AI employees
// ---------------------------------------------------------------------------

export function createAiEmployee(input: {
  userId: string;
  name: string;
  role: string;
  agentSlug?: string | null;
  assignedTo?: string | null;
}): { id: string } {
  const id = createId('emp');
  db.run(
    `INSERT INTO ai_employees (id, user_id, name, role, agent_slug, status, assigned_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [id, input.userId, input.name, input.role, input.agentSlug ?? null, input.assignedTo ?? null, NOW(), NOW()],
  );
  return { id };
}

export function listAiEmployees(userId: string): Array<Record<string, unknown>> {
  return db.all('SELECT * FROM ai_employees WHERE user_id = ? ORDER BY created_at DESC', [userId]) as Array<Record<string, unknown>>;
}
