#!/usr/bin/env tsx
/**
 * Issue (or revoke) the one-time ZA141251SA owner-password setup link.
 *
 * The link lets the mission owner type a new password into a password field in
 * their own browser — no terminal, no chat transcript, no environment file.
 * The link is single-use, expires quickly, and only ever re-keys the identity
 * configured in ZA141251SA_OWNER_EMAIL. It carries no password itself.
 *
 *   npm run mission:owner-setup-link -- --base=https://4200-host.example --ttl=30
 *   npm run mission:owner-setup-link -- --revoke
 */
import { missionEnv } from '../src/mission/database';
import { configuredMissionOwnerEmail, identityLockStatus } from '../src/mission/identity-lock';
import { clearOwnerSetupToken, issueOwnerSetupToken, maskedOwnerEmail, ownerSetupAvailability } from '../src/mission/owner-setup';

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function main(): void {
  if (process.argv.includes('--revoke')) {
    const removed = clearOwnerSetupToken();
    console.log(removed ? 'setup link revoked' : 'no setup link was active');
    return;
  }

  if (process.argv.includes('--status')) {
    console.log(JSON.stringify(ownerSetupAvailability(), null, 2));
    return;
  }

  const email = configuredMissionOwnerEmail();
  if (!email) {
    console.error('ZA141251SA_OWNER_EMAIL is not configured — refusing to issue a setup link.');
    process.exit(1);
  }

  const ttl = Number(arg('ttl') ?? 30) || 30;
  const base = (arg('base') ?? `http://127.0.0.1:${missionEnv().port}`).replace(/\/+$/, '');
  const { token, expiresAt } = issueOwnerSetupToken(ttl);

  console.log('owner              :', maskedOwnerEmail(email));
  console.log('identity lock      :', identityLockStatus().enforcedAt ? 'ENFORCED' : 'not enforced');
  console.log('expires at         :', expiresAt);
  console.log('single use         : yes (consumed on the first accepted password)');
  console.log('');
  console.log(`${base}/setup#token=${token}`);
}

main();
