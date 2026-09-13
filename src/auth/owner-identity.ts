import { db, appendAuditLog } from '../db';

/**
 * Configured owner identity (Section 4 of the production build).
 *
 * The authorized owner is identified by the configured email
 * (AKBARAL_OWNER_EMAIL — the owner's verified Google/Gmail identity, set as
 * a deployment environment value, NEVER hard-coded in source). Any active
 * account with that email is promoted to the 'owner' role server-side; the
 * promotion is one-way (an existing owner/super_admin is left untouched) and
 * audited. Suspended accounts are never promoted.
 *
 * Called at API boot and on every successful login (password + OAuth), so
 * the first Google-identity login on a fresh deployment lands as owner
 * without any manual database access.
 */

const OWNER_EMAIL_ENV = 'AKBARAL_OWNER_EMAIL';

export function configuredOwnerEmail(): string | null {
  const value = (process.env[OWNER_EMAIL_ENV] ?? '').trim().toLowerCase();
  return value.length > 0 ? value : null;
}

export function syncConfiguredOwnerIdentity(actorId: string | null = null): { promoted: boolean; email: string } | null {
  const email = configuredOwnerEmail();
  if (!email) {
    return null;
  }
  // One-way promotion: only active, non-suspended accounts; never demote an
  // existing owner/super_admin. (users.updated_at is trigger-maintained.)
  const result = db.run(
    "UPDATE users SET role = 'owner' WHERE lower(email) = ? AND status = 'active' AND role NOT IN ('owner', 'super_admin')",
    [email],
  );
  if (result.changes > 0) {
    appendAuditLog({
      actorId,
      action: 'owner_identity_promoted',
      resourceType: 'user',
      resourceId: email,
      description: 'account promoted to owner by configured AKBARAL_OWNER_EMAIL',
    });
    return { promoted: true, email };
  }
  return { promoted: false, email };
}
