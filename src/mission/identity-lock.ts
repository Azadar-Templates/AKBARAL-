import { missionDb, nowIso, appendMissionAudit, type Row } from './database';

/**
 * ZA141251SA — SINGLE-IDENTITY LOCKDOWN.
 *
 * The mission is a private system owned by exactly one configured identity
 * (ZA141251SA_OWNER_EMAIL). This module is the single enforcement point that
 * makes that literal rather than aspirational:
 *
 *   1. AUTHENTICATION allowlist — login() refuses any email that is not the
 *      configured identity, before a password is even considered.
 *   2. SESSION re-check — resolveSession() refuses (and revokes) a session
 *      whose account is not the configured identity, so a session granted by
 *      an older deployment cannot keep reading mission data.
 *   3. PROVISIONING refusal — a second owner/operator account can never be
 *      created while the lockdown is on.
 *   4. ENFORCEMENT sweep — any pre-existing non-owner account is suspended,
 *      its sessions revoked and every pre-existing access link revoked the
 *      first time the lockdown runs (and again if the configured identity
 *      changes, because the old links were issued under a different owner).
 *
 * Nothing here is synthesized: if ZA141251SA_OWNER_EMAIL is not configured the
 * lockdown is simply OFF and reports itself as off, rather than inventing an
 * identity to protect.
 */

const OWNER_EMAIL_ENV = 'ZA141251SA_OWNER_EMAIL';
const LOCK_ROW_ID = 'global';

export interface IdentityLockStatus {
  enabled: boolean;
  configuredEmail: string | null;
  enforcedAt: string | null;
  ownersSuspended: number;
  sessionsRevoked: number;
  linksRevoked: number;
}

export interface LockEnforcement extends IdentityLockStatus {
  /** true when the destructive sweep ran in THIS call (first run or identity change). */
  swept: boolean;
  /** Active owner rows that are NOT the configured identity (must be 0). */
  foreignActiveOwners: number;
}

function normalise(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** The one configured mission identity, or null when the lockdown is off. */
export function configuredMissionOwnerEmail(): string | null {
  const value = normalise(process.env[OWNER_EMAIL_ENV]);
  return value.length > 0 ? value : null;
}

export function identityLockEnabled(): boolean {
  return configuredMissionOwnerEmail() !== null;
}

/** Would this email be allowed to authenticate? Lock off ⇒ everything passes. */
export function isIdentityPermitted(email: string | null | undefined): boolean {
  const configured = configuredMissionOwnerEmail();
  if (!configured) return true;
  return normalise(email) === configured;
}

/**
 * Reason text for a refused identity. Deliberately does not echo the
 * configured address back to the caller: an unauthenticated request learns
 * only that this deployment is single-identity, never who the identity is.
 */
export function identityRefusalMessage(): string {
  return 'this deployment is restricted to its configured mission identity — no other account may authenticate or read mission data';
}

/** Provisioning guard: returns a refusal reason, or null when provisioning is allowed. */
export function provisioningRefusalReason(email: string): string | null {
  if (!identityLockEnabled()) return null;
  if (isIdentityPermitted(email)) return null;
  return 'ZA141251SA is locked to a single configured identity — no additional mission accounts can be provisioned';
}

function lockRow(): Row | undefined {
  return missionDb.get<Row>('SELECT * FROM mission_identity_lock WHERE id = ?', [LOCK_ROW_ID]);
}

export function identityLockStatus(): IdentityLockStatus {
  const configured = configuredMissionOwnerEmail();
  const row = lockRow();
  return {
    enabled: configured !== null,
    configuredEmail: configured,
    enforcedAt: row ? String(row.enforced_at) : null,
    ownersSuspended: row ? Number(row.owners_suspended) : 0,
    sessionsRevoked: row ? Number(row.sessions_revoked) : 0,
    linksRevoked: row ? Number(row.links_revoked) : 0,
  };
}

/**
 * Run the lockdown sweep. Idempotent: the destructive part (suspending
 * foreign accounts, revoking their sessions, revoking pre-existing access
 * links) runs on the first call and again only when the configured identity
 * changes. Safe to call at every boot.
 */
export function enforceIdentityLock(): LockEnforcement {
  const configured = configuredMissionOwnerEmail();
  if (!configured) {
    return { ...identityLockStatus(), swept: false, foreignActiveOwners: activeForeignOwnerCount(null) };
  }

  const previous = lockRow();
  const identityChanged = !previous || String(previous.locked_email) !== configured;
  let ownersSuspended = previous ? Number(previous.owners_suspended) : 0;
  let sessionsRevoked = previous ? Number(previous.sessions_revoked) : 0;
  let linksRevoked = previous ? Number(previous.links_revoked) : 0;

  if (identityChanged) {
    missionDb.transaction(() => {
      // 1. Suspend every foreign account (owner or operator) — suspending is
      //    what makes resolveSession() reject it even if a session survived.
      const suspended = missionDb.run(
        `UPDATE mission_owner SET status = 'suspended', updated_at = ?
          WHERE lower(email) != ? AND status != 'suspended'`,
        [nowIso(), configured],
      );
      // 2. Revoke every session that is not the configured identity's.
      const revoked = missionDb.run(
        `UPDATE mission_sessions SET revoked_at = ?
          WHERE revoked_at IS NULL
            AND owner_id IN (SELECT id FROM mission_owner WHERE lower(email) != ?)`,
        [nowIso(), configured],
      );
      // 3. Revoke pre-existing access links: they were issued under the
      //    previous operating model and must not be able to read mission data
      //    after the lockdown. The owner can deliberately mint new ones.
      const links = missionDb.run(
        `UPDATE mission_access_links SET revoked_at = ? WHERE revoked_at IS NULL`,
        [nowIso()],
      );
      ownersSuspended += Number(suspended.changes ?? 0);
      sessionsRevoked += Number(revoked.changes ?? 0);
      linksRevoked += Number(links.changes ?? 0);
      missionDb.run(
        `INSERT INTO mission_identity_lock (id, locked_email, enforced_at, owners_suspended, sessions_revoked, links_revoked)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET locked_email = excluded.locked_email, enforced_at = excluded.enforced_at,
           owners_suspended = excluded.owners_suspended, sessions_revoked = excluded.sessions_revoked,
           links_revoked = excluded.links_revoked`,
        [LOCK_ROW_ID, configured, nowIso(), ownersSuspended, sessionsRevoked, linksRevoked],
      );
    });
    appendMissionAudit({
      actorType: 'system',
      action: 'identity_lock.enforced',
      subjectType: 'identity_lock',
      subjectId: LOCK_ROW_ID,
      detail: {
        // Only a fingerprint of the identity is written to the tamper-evident
        // log: the audit chain is exportable, the address need not travel.
        identity: `${configured.slice(0, 2)}…${configured.slice(configured.indexOf('@'))}`,
        ownersSuspended: Number(missionDb.get<Row>('SELECT owners_suspended FROM mission_identity_lock WHERE id = ?', [LOCK_ROW_ID])?.owners_suspended ?? 0),
        sessionsRevoked,
        linksRevoked,
      },
    });
  }

  return { ...identityLockStatus(), swept: identityChanged, foreignActiveOwners: activeForeignOwnerCount(configured) };
}

/**
 * Verify the lockdown actually holds: no other account is active and no live
 * session belongs to another identity. Used by the boot banner and the
 * production verification script — a boolean claim is never trusted alone.
 */
export function activeForeignOwnerCount(configured: string | null = configuredMissionOwnerEmail()): number {
  if (!configured) return 0;
  const row = missionDb.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM mission_owner WHERE lower(email) != ? AND status = 'active'",
    [configured],
  );
  return Number(row?.count ?? 0);
}

export function liveForeignSessionCount(configured: string | null = configuredMissionOwnerEmail()): number {
  if (!configured) return 0;
  const row = missionDb.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM mission_sessions s
       JOIN mission_owner o ON o.id = s.owner_id
      WHERE s.revoked_at IS NULL AND lower(o.email) != ? AND s.expires_at > ?`,
    [configured, nowIso()],
  );
  return Number(row?.count ?? 0);
}

/** True when the lockdown is required and verified clean. */
export function identityLockVerified(): { ok: boolean; reason: string | null } {
  if (!identityLockEnabled()) return { ok: false, reason: 'ZA141251SA_OWNER_EMAIL is not configured — the single-identity lockdown is OFF' };
  const enforcement = enforceIdentityLock();
  if (enforcement.foreignActiveOwners > 0) {
    return { ok: false, reason: `${enforcement.foreignActiveOwners} non-owner mission account(s) are still active` };
  }
  const liveForeign = liveForeignSessionCount();
  if (liveForeign > 0) return { ok: false, reason: `${liveForeign} live session(s) belong to another identity` };
  return { ok: true, reason: null };
}
