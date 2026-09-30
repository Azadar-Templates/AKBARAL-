/**
 * AKBARAL! — owner identity bootstrap CLI — `npm run owner:bootstrap`
 *
 * This is the ONLY supported way to grant the 'owner' role to an account.
 * It requires direct access to run commands against this server/database/
 * environment — a fundamentally different (and much higher) trust bar than
 * "registered an account through the public sign-up form", which is exactly
 * why registration and login never grant 'owner' anymore (see
 * src/auth/owner-identity.ts for the full rationale: the previous design
 * auto-promoted on login purely from an email match, so whoever registered
 * the owner's email address FIRST — with no verification at all — silently
 * became the owner; that email-squatting hole is closed by requiring this
 * out-of-band step instead).
 *
 * The owner's email is fixed and NOT an input to this script — it is always
 * `zanaveed555@gmail.com` (src/auth/owner-identity.ts), so there is no way
 * to accidentally bootstrap the wrong identity.
 *
 * Required (set in the process environment, never in source control):
 *   AKBARAL_OWNER_PASSWORD                the owner's sign-in password
 *                                          (>= 12 characters). Never logged.
 *
 * If an account already exists for the fixed owner email that is NOT already
 * an owner/super_admin (e.g. someone registered it publicly before you did,
 * or you signed up normally yourself first), this refuses to touch it and
 * explains exactly what it found. Only after you have verified that account
 * is genuinely yours do you re-run with:
 *   AKBARAL_OWNER_BOOTSTRAP_CONFIRM_TAKEOVER=yes
 *
 * Without AKBARAL_OWNER_PASSWORD, this command does nothing except report
 * status — it never invents an account or a password.
 */
import { applyMigrations } from '../src/db/migrate';
import { db, findUserByEmail } from '../src/db';
import {
  FIXED_OWNER_EMAIL,
  OwnerBootstrapConfirmationRequiredError,
  bootstrapOwnerAccount,
} from '../src/auth/owner-identity';

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(30, '.')} ${value}\n`);
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

async function main(): Promise<void> {
  process.stdout.write('\nAKBARAL! — owner identity bootstrap\n');
  process.stdout.write('='.repeat(72) + '\n');

  applyMigrations(db);
  line('owner email (fixed, not an input)', FIXED_OWNER_EMAIL);

  const password = process.env.AKBARAL_OWNER_PASSWORD ?? '';
  if (!password) {
    line('AKBARAL_OWNER_PASSWORD', 'NOT set — nothing will be created or changed');
    const existing = findUserByEmail(FIXED_OWNER_EMAIL);
    line('existing account for this email', existing ? `present (role=${existing.role}, id=${existing.id})` : 'none yet');
    process.stdout.write('\n  Set AKBARAL_OWNER_PASSWORD and re-run to bootstrap.\n\n');
    return;
  }

  const confirmTakeover = truthy(process.env.AKBARAL_OWNER_BOOTSTRAP_CONFIRM_TAKEOVER);
  try {
    const result = await bootstrapOwnerAccount({ password, confirmTakeover });
    line('result', result.action === 'created' ? `created a fresh owner account (id=${result.userId})` : `existing account updated (id=${result.userId})`);
    line('role', 'owner');
    process.stdout.write('\n  Next: sign in normally at /signin with this email and password.\n\n');
  } catch (error) {
    if (error instanceof OwnerBootstrapConfirmationRequiredError) {
      process.stderr.write(`\n  REFUSED — ${error.message}\n\n`);
      process.stderr.write('  If you have independently verified this is genuinely your account,\n');
      process.stderr.write('  re-run with:\n');
      process.stderr.write('    AKBARAL_OWNER_BOOTSTRAP_CONFIRM_TAKEOVER=yes\n\n');
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`\nowner:bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
