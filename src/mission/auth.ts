import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { missionDb, missionId, nowIso, sha256, appendMissionAudit, type Row } from './database';

/**
 * PRIVATE MISSION AUTHENTICATION — completely separate from AKBARAL! accounts.
 *
 * There is no shared session, no shared cookie and no shared password store:
 * mission sessions are issued by this module, hashed with SHA-256 before
 * storage, bound to an expiry, rotated on every login, and revocable. A leaked
 * AKBARAL! token grants nothing here (and vice versa) because the lookup only
 * ever happens against the mission database with the mission secret.
 *
 * CREDENTIAL VAULT: provider credentials are encrypted with AES-256-GCM using a
 * key derived from ZA141251SA_CREDENTIAL_KEY. The plaintext is never returned by
 * any API surface — only provider, label, scope, expiry and a masked hint are.
 * Decryption exists solely for in-process provider calls.
 */

const SESSION_TTL_HOURS = Number(process.env.ZA141251SA_SESSION_TTL_HOURS ?? 12) || 12;
const ACCESS_LINK_DEFAULT_HOURS = Number(process.env.ZA141251SA_ACCESS_LINK_HOURS ?? 24) || 24;

export class MissionAuthError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'MissionAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ── Password hashing (scrypt) ────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const derived = scryptSync(password, Buffer.from(salt, 'base64'), 64, { N: Number(n), r: Number(r), p: Number(p) });
    const expected = Buffer.from(hash, 'base64');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ── Owner provisioning / login ───────────────────────────────────────────────

export interface MissionOwner {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
}

interface OwnerRow extends Row {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
  role: string;
  status: string;
}

export function ownerCount(): number {
  return Number(missionDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_owner')?.count ?? 0);
}

/**
 * Create the private owner account. Used by `npm run mission:init`, which reads
 * ZA141251SA_OWNER_EMAIL / ZA141251SA_OWNER_PASSWORD from the environment — the
 * password is hashed immediately and never stored or logged in plaintext.
 */
export function provisionOwner(input: { email: string; password: string; displayName?: string }): MissionOwner {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new MissionAuthError(400, 'a valid owner email is required', 'validation_error');
  if (input.password.length < 12) {
    throw new MissionAuthError(400, 'the owner password must be at least 12 characters', 'validation_error');
  }
  const existing = missionDb.get<OwnerRow>('SELECT * FROM mission_owner WHERE email = ?', [email]);
  const passwordHash = hashPassword(input.password);
  if (existing) {
    missionDb.run(
      `UPDATE mission_owner SET password_hash = ?, display_name = COALESCE(?, display_name), updated_at = ? WHERE id = ?`,
      [passwordHash, input.displayName ?? null, nowIso(), existing.id],
    );
    appendMissionAudit({ actorType: 'system', action: 'owner.password_reset', subjectType: 'owner', subjectId: existing.id });
    return { id: existing.id, email, displayName: input.displayName ?? existing.display_name, role: existing.role, status: existing.status };
  }
  const id = missionId('own');
  missionDb.run(
    `INSERT INTO mission_owner (id, email, display_name, password_hash, role, status) VALUES (?, ?, ?, ?, 'owner', 'active')`,
    [id, email, input.displayName ?? null, passwordHash],
  );
  appendMissionAudit({ actorType: 'system', action: 'owner.provisioned', subjectType: 'owner', subjectId: id, detail: { email } });
  return { id, email, displayName: input.displayName ?? null, role: 'owner', status: 'active' };
}

export interface MissionSession {
  token: string;
  csrfToken: string;
  expiresAt: string;
  owner: MissionOwner;
}

export function login(input: { email: string; password: string; ip?: string | null; userAgent?: string | null }): MissionSession {
  const email = input.email.trim().toLowerCase();
  const row = missionDb.get<OwnerRow>('SELECT * FROM mission_owner WHERE email = ?', [email]);
  // Constant-ish work either way: always run a verification to avoid revealing
  // whether the email exists through timing.
  const dummyHash = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
  const ok = verifyPassword(input.password, row?.password_hash ?? dummyHash);
  if (!row || !ok) {
    appendMissionAudit({ actorType: 'system', action: 'auth.login_failed', detail: { email } });
    throw new MissionAuthError(401, 'invalid credentials', 'unauthorized');
  }
  if (String(row.status) !== 'active') {
    throw new MissionAuthError(403, 'this mission account is not active', 'forbidden');
  }

  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  missionDb.transaction(() => {
    // Rotate: every login invalidates the account's previous sessions.
    missionDb.run(`UPDATE mission_sessions SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL`, [nowIso(), row.id]);
    missionDb.run(
      `INSERT INTO mission_sessions (id, owner_id, token_hash, csrf_hash, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [missionId('ses'), row.id, sha256(token), sha256(csrfToken), input.ip ?? null, (input.userAgent ?? '').slice(0, 200) || null, expiresAt],
    );
    missionDb.run(`UPDATE mission_owner SET last_login_at = ? WHERE id = ?`, [nowIso(), row.id]);
  });
  appendMissionAudit({ actorType: 'owner', actorId: row.id, action: 'auth.login', subjectType: 'owner', subjectId: row.id });
  return {
    token,
    csrfToken,
    expiresAt,
    owner: { id: row.id, email: row.email, displayName: row.display_name, role: row.role, status: row.status },
  };
}

export function logout(token: string): boolean {
  const hash = sha256(token);
  const session = missionDb.get<{ id: string; owner_id: string }>('SELECT id, owner_id FROM mission_sessions WHERE token_hash = ? AND revoked_at IS NULL', [hash]);
  if (!session) return false;
  missionDb.run('UPDATE mission_sessions SET revoked_at = ? WHERE id = ?', [nowIso(), session.id]);
  appendMissionAudit({ actorType: 'owner', actorId: session.owner_id, action: 'auth.logout', subjectType: 'owner', subjectId: session.owner_id });
  return true;
}

export interface SessionContext {
  owner: MissionOwner;
  sessionId: string;
  csrfTokenHash: string | null;
}

export function resolveSession(token: string | null): SessionContext | null {
  if (!token) return null;
  const hash = sha256(token);
  const session = missionDb.get<Row & { id: string; owner_id: string; expires_at: string; csrf_hash: string | null }>(
    'SELECT * FROM mission_sessions WHERE token_hash = ? AND revoked_at IS NULL',
    [hash],
  );
  if (!session) return null;
  if (new Date(String(session.expires_at)).getTime() <= Date.now()) return null;
  const owner = missionDb.get<OwnerRow>('SELECT * FROM mission_owner WHERE id = ?', [String(session.owner_id)]);
  if (!owner || String(owner.status) !== 'active') return null;
  return {
    owner: { id: owner.id, email: owner.email, displayName: owner.display_name, role: owner.role, status: owner.status },
    sessionId: String(session.id),
    csrfTokenHash: session.csrf_hash ? String(session.csrf_hash) : null,
  };
}

/** Operator role is read-only: mutations require the owner role. */
export function assertCanMutate(context: SessionContext): void {
  if (context.owner.role !== 'owner') {
    throw new MissionAuthError(403, 'this mission role is read-only', 'forbidden');
  }
}

// ── Scoped agent / operator access links ─────────────────────────────────────

export interface AccessLink {
  id: string;
  label: string;
  scope: string;
  agentId: string | null;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
}

export function createAccessLink(input: {
  label: string;
  scope: 'dashboard:read' | 'agent:self' | 'owner:read';
  agentId?: string | null;
  expiresInHours?: number;
  maxUses?: number | null;
  createdBy?: string | null;
}): { link: AccessLink; token: string } {
  const token = `zal_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + (input.expiresInHours ?? ACCESS_LINK_DEFAULT_HOURS) * 3600 * 1000).toISOString();
  const id = missionId('lnk');
  missionDb.run(
    `INSERT INTO mission_access_links (id, label, token_hash, scope, agent_id, max_uses, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.label.slice(0, 120), sha256(token), input.scope, input.agentId ?? null, input.maxUses ?? null, expiresAt, input.createdBy ?? null],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.createdBy ?? null,
    action: 'access_link.created',
    subjectType: 'access_link',
    subjectId: id,
    detail: { label: input.label, scope: input.scope, agentId: input.agentId ?? null, expiresAt, maxUses: input.maxUses ?? null },
  });
  return { link: getAccessLink(id)!, token };
}

function getAccessLink(id: string): AccessLink | null {
  const row = missionDb.get<Row>('SELECT * FROM mission_access_links WHERE id = ?', [id]);
  if (!row) return null;
  return {
    id: String(row.id),
    label: String(row.label),
    scope: String(row.scope),
    agentId: row.agent_id ? String(row.agent_id) : null,
    expiresAt: String(row.expires_at),
    maxUses: row.max_uses === null ? null : Number(row.max_uses),
    useCount: Number(row.use_count),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
  };
}

export function listAccessLinks(): AccessLink[] {
  return missionDb
    .all<Row>('SELECT id FROM mission_access_links ORDER BY created_at DESC')
    .map((row) => getAccessLink(String(row.id)))
    .filter((link): link is AccessLink => Boolean(link));
}

export function revokeAccessLink(id: string, actorId: string): boolean {
  const result = missionDb.run('UPDATE mission_access_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso(), id]);
  if (result.changes > 0) {
    appendMissionAudit({ actorType: 'owner', actorId, action: 'access_link.revoked', subjectType: 'access_link', subjectId: id });
    return true;
  }
  return false;
}

export interface LinkContext {
  link: AccessLink;
  agentId: string | null;
}

/** Resolve a link token, enforcing revocation, expiry and the use budget. */
export function resolveAccessLink(token: string | null): LinkContext | null {
  if (!token) return null;
  const row = missionDb.get<Row>('SELECT * FROM mission_access_links WHERE token_hash = ?', [sha256(token)]);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
  const maxUses = row.max_uses === null ? null : Number(row.max_uses);
  if (maxUses !== null && Number(row.use_count) >= maxUses) return null;
  missionDb.run(
    'UPDATE mission_access_links SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
    [nowIso(), String(row.id)],
  );
  const link = getAccessLink(String(row.id));
  if (!link) return null;
  return { link, agentId: link.agentId };
}

// ── Credential vault (AES-256-GCM, key from the environment) ─────────────────

function vaultKey(): Buffer {
  const secret = (process.env.ZA141251SA_CREDENTIAL_KEY ?? '').trim();
  if (secret.length < 32) {
    throw new MissionAuthError(
      503,
      'ZA141251SA_CREDENTIAL_KEY is not configured (32+ characters required) — credential storage is disabled until it is set',
      'vault_not_configured',
    );
  }
  return createHash('sha256').update(secret).digest();
}

export function vaultConfigured(): boolean {
  return (process.env.ZA141251SA_CREDENTIAL_KEY ?? '').trim().length >= 32;
}

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
  hint: string;
}

export function encryptCredential(plaintext: string, hintLength = 4): EncryptedValue {
  const key = vaultKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const tail = plaintext.slice(-hintLength);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    hint: `…${tail}`,
  };
}

/** In-process only. Never exposed through HTTP. */
export function decryptCredential(record: { ciphertext: string; iv: string; tag: string }): string {
  const key = vaultKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Redact anything that looks like a secret from an outgoing payload. Used as a
 * belt-and-braces filter on mission responses that embed provider metadata.
 */
export function redactSecrets<T>(value: T): T {
  const pattern = /(sk-[A-Za-z0-9]{12,}|tvly-[A-Za-z0-9]{10,}|AIza[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._\-]{16,})/g;
  if (typeof value === 'string') return value.replace(pattern, '[redacted]') as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry)) as unknown as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactSecrets(entry);
    }
    return output as unknown as T;
  }
  return value;
}
