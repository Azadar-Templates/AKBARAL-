import { db, appendAuditLog, createUser, findUserByEmail, setUserPasswordHash } from '../db';
import { hashPassword } from '../security/password';

/**
 * Fixed platform owner identity (Section 4 of the production build).
 *
 * AKBARAL! + the private ZA141251SA mission system have exactly ONE owner
 * identity, hard-coded here — NOT read from an environment variable, NOT
 * supplied by a client, NOT derived from a request.
 *
 * Critically, the 'owner' role is NEVER granted by ordinary public
 * registration or login — not even to an account using this exact literal
 * email string. A stranger who registers `zanaveed555@gmail.com` on the
 * public sign-up form gets nothing but an ordinary `user` account (this used
 * to auto-promote on login purely from an email match, which meant whoever
 * registered that address FIRST silently became owner — an email-squatting
 * takeover with no verification at all; that mechanism has been removed).
 *
 * The ONLY way any account is ever granted 'owner' is `bootstrapOwnerAccount`
 * below, invoked exclusively by the operator-run CLI
 * `npm run owner:bootstrap` (scripts/owner-init.ts) — a command that requires
 * direct access to the server/database/environment, which is a fundamentally
 * different, much higher trust bar than "typed a string into a public HTML
 * form". Nothing under `src/routes/**`, `src/auth/service.ts` or
 * `src/auth/oauth.ts` calls it, and it must stay that way.
 *
 * The promotion:
 *   - is scoped to exactly this email — no other account is ever touched;
 *   - refuses to overwrite/promote a DIFFERENT pre-existing account for that
 *     email unless the operator explicitly, separately confirms a takeover
 *     (`confirmTakeover` / `AKBARAL_OWNER_BOOTSTRAP_CONFIRM_TAKEOVER=yes`) —
 *     this is the guard against exactly the squatting scenario above: even
 *     the trusted CLI will not silently seize a row it did not create;
 *   - is one-way once trusted (an existing owner/super_admin is left alone —
 *     rotating its password never touches its role);
 *   - is audited (an `owner_bootstrap_*` row is written every time).
 *
 * This module NEVER trusts a role, email or claim supplied by the browser:
 * the comparison is always against the account row already stored in the
 * database, looked up server-side. See `src/auth/entitlements.ts` for how
 * the resulting `role` column is turned into the unlimited-execution
 * entitlement, and `src/server/middleware/rbac.ts` for how it gates
 * owner-only routes — both read the DB/JWT-verified role only.
 *
 * This module has no relationship to ZA141251SA mission authorization.
 * The private mission dashboard/API (`src/routes/boss-dashboard.ts`,
 * `src/mission/server.ts`) is gated purely by its own out-of-band bearer
 * token and never consults this file, any user account, or any AKBARAL!
 * customer session — by design, so that AKBARAL! customer authentication
 * (including this owner account's own customer session) can never become
 * mission authorization.
 */

/** The one and only AKBARAL! + ZA141251SA owner identity. */
export const FIXED_OWNER_EMAIL = 'zanaveed555@gmail.com';

/** The owner bootstrap credential is a real account password, not a UI toy. */
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

/** Trim + lowercase — the only safe way to compare an email server-side. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `email` (any casing/whitespace) is the fixed owner identity. */
export function isFixedOwnerEmail(email: string): boolean {
  return normalizeEmail(email) === FIXED_OWNER_EMAIL;
}

export interface OwnerBootstrapResult {
  /** 'created' = a fresh account was made; 'rotated' = an existing row was updated. */
  action: 'created' | 'rotated';
  email: string;
  userId: string;
}

/**
 * Thrown when a DIFFERENT, pre-existing account (not already owner/
 * super_admin) already holds the target email. Bootstrapping refuses to
 * touch it without an explicit, separate takeover confirmation — this is
 * what stops an email-squatter's account from being blindly promoted just
 * because it happens to hold the right address.
 */
export class OwnerBootstrapConfirmationRequiredError extends Error {
  readonly existing: { id: string; email: string; role: string; createdAt: string };

  constructor(existing: { id: string; email: string; role: string; createdAt: string }) {
    super(
      `an account already exists for ${existing.email} (id=${existing.id}, role=${existing.role}, ` +
        `created ${existing.createdAt}) that is not already an owner. Bootstrapping would overwrite ` +
        'its password and grant it the owner role. Re-run with an explicit takeover confirmation ' +
        '(confirmTakeover: true, or AKBARAL_OWNER_BOOTSTRAP_CONFIRM_TAKEOVER=yes for the CLI) only ' +
        'after you have verified this account is genuinely yours.',
    );
    this.name = 'OwnerBootstrapConfirmationRequiredError';
    this.existing = existing;
  }
}

/**
 * The ONLY way any account is ever granted the 'owner' role.
 *
 * This is an operator-invoked bootstrap primitive: `npm run owner:bootstrap`
 * (scripts/owner-init.ts). It must never be called from an HTTP route, from
 * registration, or from login — that boundary is what makes ownership
 * un-squattable. See the module docstring above.
 *
 * `overrideEmail` is a TEST-ONLY seam so the suite can exercise this
 * mechanism against disposable synthetic emails without touching the real
 * owner account; production (the CLI) never passes it, so production can
 * only ever bootstrap `FIXED_OWNER_EMAIL`.
 */
export async function bootstrapOwnerAccount(input: {
  password: string;
  actorId?: string | null;
  overrideEmail?: string;
  confirmTakeover?: boolean;
}): Promise<OwnerBootstrapResult> {
  if (!input.password || input.password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new Error(`the owner bootstrap password must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`);
  }
  const email =
    typeof input.overrideEmail === 'string' && input.overrideEmail.trim().length > 0
      ? normalizeEmail(input.overrideEmail)
      : FIXED_OWNER_EMAIL;

  const passwordHash = await hashPassword(input.password);
  const existing = findUserByEmail(email);

  if (!existing) {
    const created = createUser({ email, name: 'Owner', role: 'owner', status: 'active', passwordHash });
    appendAuditLog({
      actorId: input.actorId ?? null,
      action: 'owner_bootstrap_created',
      resourceType: 'user',
      resourceId: created.id,
      description: 'owner account created directly by the operator-invoked bootstrap (never through public registration)',
    });
    return { action: 'created', email, userId: created.id };
  }

  const alreadyTrusted = existing.role === 'owner' || existing.role === 'super_admin';
  if (!alreadyTrusted && !input.confirmTakeover) {
    throw new OwnerBootstrapConfirmationRequiredError({
      id: existing.id,
      email: existing.email,
      role: existing.role,
      createdAt: existing.created_at,
    });
  }

  setUserPasswordHash(existing.id, passwordHash);
  if (!alreadyTrusted) {
    db.run("UPDATE users SET role = 'owner' WHERE id = ?", [existing.id]);
  }
  appendAuditLog({
    actorId: input.actorId ?? null,
    action: alreadyTrusted ? 'owner_bootstrap_password_rotated' : 'owner_bootstrap_takeover_confirmed',
    resourceType: 'user',
    resourceId: existing.id,
    description: alreadyTrusted
      ? 'owner credential rotated by the operator-invoked bootstrap'
      : 'pre-existing account promoted to owner by the operator-invoked bootstrap after an explicit takeover confirmation',
  });
  return { action: 'rotated', email, userId: existing.id };
}
