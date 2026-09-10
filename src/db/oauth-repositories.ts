import { db } from './database';
import { createId } from './id';

/**
 * OAuth identity + state persistence (migration 0011).
 *
 * Security contract:
 *   - A (provider, provider_account_id) pair can be linked to exactly one
 *     user (UNIQUE index) — the guarded insert is what makes account takeover
 *     via re-linking impossible.
 *   - States are stored hashed, are single-use (guarded UPDATE on
 *     consumed_at) and expire; nothing trusts an unconsumed stale state.
 */

export type OAuthProviderKey = 'google' | 'github' | 'microsoft' | 'apple';

export interface OAuthIdentityRow {
  id: string;
  user_id: string;
  provider: OAuthProviderKey;
  provider_account_id: string;
  email_at_link: string | null;
  created_at: string;
}

export function insertOAuthIdentity(input: {
  userId: string;
  provider: OAuthProviderKey;
  providerAccountId: string;
  emailAtLink: string | null;
}): OAuthIdentityRow | undefined {
  const id = createId('oai');
  try {
    db.run(
      `INSERT INTO oauth_identities (id, user_id, provider, provider_account_id, email_at_link, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.userId, input.provider, input.providerAccountId, input.emailAtLink, new Date().toISOString()],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toUpperCase().includes('UNIQUE')) {
      return undefined; // already linked (to this or another user)
    }
    throw error;
  }
  return db.get<OAuthIdentityRow>('SELECT * FROM oauth_identities WHERE id = ?', [id]);
}

export function findOAuthIdentity(provider: OAuthProviderKey, providerAccountId: string): OAuthIdentityRow | undefined {
  return db.get<OAuthIdentityRow>('SELECT * FROM oauth_identities WHERE provider = ? AND provider_account_id = ?', [provider, providerAccountId]);
}

export function listOAuthIdentitiesByUser(userId: string): OAuthIdentityRow[] {
  return db.all<OAuthIdentityRow>('SELECT * FROM oauth_identities WHERE user_id = ? ORDER BY created_at ASC', [userId]);
}

export function deleteOAuthIdentity(userId: string, provider: OAuthProviderKey): boolean {
  const result = db.run('DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?', [userId, provider]);
  return result.changes === 1;
}

// ---------------------------------------------------------------------------
// States (CSRF)
// ---------------------------------------------------------------------------

export interface OAuthStateRow {
  id: string;
  state_hash: string;
  provider: OAuthProviderKey;
  mode: 'login' | 'link';
  user_id: string | null;
  code_verifier: string | null;
  redirect_uri: string;
  ip: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export function insertOAuthState(input: {
  stateHash: string;
  provider: OAuthProviderKey;
  mode: 'login' | 'link';
  userId: string | null;
  codeVerifier: string | null;
  redirectUri: string;
  ip: string | null;
  expiresAt: string;
}): void {
  const id = createId('oas');
  db.run(
    `INSERT INTO oauth_states (id, state_hash, provider, mode, user_id, code_verifier, redirect_uri, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.stateHash,
      input.provider,
      input.mode,
      input.userId,
      input.codeVerifier,
      input.redirectUri,
      input.ip,
      new Date().toISOString(),
      input.expiresAt,
    ],
  );
}

/** Read-only state lookup by raw state value (no consumption). */
export function peekOAuthState(stateHash: string): OAuthStateRow | undefined {
  return db.get<OAuthStateRow>('SELECT * FROM oauth_states WHERE state_hash = ?', [stateHash]);
}

/**
 * Consume a state: exactly one caller can transition it (single-use), and
 * only before expiry. The guarded UPDATE makes replay and races impossible.
 */
export function consumeOAuthState(stateHash: string): OAuthStateRow | undefined {
  const result = db.run(
    `UPDATE oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [new Date().toISOString(), stateHash, new Date().toISOString()],
  );
  if (result.changes !== 1) {
    return undefined;
  }
  return db.get<OAuthStateRow>('SELECT * FROM oauth_states WHERE state_hash = ?', [stateHash]);
}

/** Housekeeping: remove consumed/expired state rows (called opportunistically). */
export function pruneOAuthStates(): void {
  db.run(`DELETE FROM oauth_states WHERE expires_at < ? OR consumed_at IS NOT NULL`, [
    new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  ]);
}
