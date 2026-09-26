// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — one-time owner password setup
//
// The mission owner password is never transported through a chat transcript, a
// command line, an environment file or a log. Two intake paths exist and both
// take the secret straight from the operator into a scrypt hash:
//
//   1. `npm run mission:set-owner-password` — stdin/TTY (needs a terminal).
//   2. This module — a single-use, short-lived setup link that renders a
//      password field in the operator's own browser.
//
// The HTTP surface of (2) exists ONLY while an unconsumed, unexpired token file
// is present on disk; otherwise the routes 404 exactly like any unknown path.
// The token is stored as a SHA-256 digest, compared in constant time, limited
// to a handful of attempts, and consumed the moment a password is accepted.
// The password itself is passed directly to provisionOwner() (scrypt) and is
// never written to disk, audit detail, or a log line.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { appendMissionAudit, missionDb, nowIso, resolveMissionDbPath, sha256, type Row } from './database';
import { MissionAuthError, provisionOwner } from './auth';
import { configuredMissionOwnerEmail, enforceIdentityLock } from './identity-lock';

const MAX_ATTEMPTS = 8;

interface SetupState {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
}

export function ownerSetupStatePath(): string {
  return path.join(path.dirname(resolveMissionDbPath()), 'mission-owner-setup.json');
}

export function verificationReportPath(): string {
  return path.resolve(process.cwd(), 'logs/mission-owner-setup/result.json');
}

function readState(): SetupState | null {
  const file = ownerSetupStatePath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SetupState;
    if (!parsed || typeof parsed.tokenHash !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: SetupState): void {
  const file = ownerSetupStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort on exotic filesystems */
  }
}

export function clearOwnerSetupToken(): boolean {
  const file = ownerSetupStatePath();
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

function digest(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function stateUsable(state: SetupState | null): state is SetupState {
  if (!state) return false;
  if (state.consumedAt) return false;
  if (state.attempts >= MAX_ATTEMPTS) return false;
  return Date.parse(state.expiresAt) > Date.now();
}

/** Mask the configured identity so the setup page can confirm *which* account
 *  it is keying without publishing the full address on an unauthenticated page. */
export function maskedOwnerEmail(email: string | null = configuredMissionOwnerEmail()): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return null;
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export interface OwnerSetupAvailability {
  available: boolean;
  maskedEmail: string | null;
  expiresAt: string | null;
  attemptsRemaining: number;
}

export function ownerSetupAvailability(): OwnerSetupAvailability {
  const state = readState();
  if (!stateUsable(state)) {
    return { available: false, maskedEmail: null, expiresAt: null, attemptsRemaining: 0 };
  }
  return {
    available: true,
    maskedEmail: maskedOwnerEmail(),
    expiresAt: state.expiresAt,
    attemptsRemaining: MAX_ATTEMPTS - state.attempts,
  };
}

const PAGE_GRACE_MINUTES = 15;

/**
 * The setup page stays reachable for a few minutes after the link is consumed
 * so the browser-side verification (which deliberately reloads the page) can
 * finish. The API that actually sets a password does not get this grace.
 */
export function ownerSetupPageServable(): boolean {
  const state = readState();
  if (!state) return false;
  const consumedAt = state.consumedAt;
  if (stateUsable(state)) return true;
  if (!consumedAt) return false;
  return Date.now() - Date.parse(consumedAt) <= PAGE_GRACE_MINUTES * 60_000;
}

export function issueOwnerSetupToken(ttlMinutes = 30): { token: string; expiresAt: string } {
  const configured = configuredMissionOwnerEmail();
  if (!configured) {
    throw new MissionAuthError(400, 'ZA141251SA_OWNER_EMAIL must be configured before a setup link can be issued', 'validation_error');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + Math.max(1, ttlMinutes) * 60_000).toISOString();
  writeState({ tokenHash: digest(token), createdAt: nowIso(), expiresAt, attempts: 0, consumedAt: null });
  appendMissionAudit({
    actorType: 'system',
    action: 'owner.setup_link_issued',
    subjectType: 'owner',
    subjectId: configured,
    detail: { expiresAt, ttlMinutes },
  });
  return { token, expiresAt };
}

function registerFailedAttempt(state: SetupState): void {
  const next = { ...state, attempts: state.attempts + 1 };
  if (next.attempts >= MAX_ATTEMPTS) {
    clearOwnerSetupToken();
    appendMissionAudit({ actorType: 'system', action: 'owner.setup_link_burned', detail: { reason: 'too_many_attempts' } });
    return;
  }
  writeState(next);
}

export interface OwnerSetupResult {
  ok: true;
  email: string;
  identityLock: ReturnType<typeof enforceIdentityLock>;
}

/**
 * Consume the one-time token and re-key the configured mission owner.
 * `password` is forwarded straight to scrypt hashing; it is never persisted,
 * echoed, or included in audit detail.
 */
export function completeOwnerSetup(input: { token: string; password: string }): OwnerSetupResult {
  const state = readState();
  if (!stateUsable(state)) {
    throw new MissionAuthError(404, 'no owner setup link is active', 'not_found');
  }
  const supplied = digest(String(input.token ?? ''));
  const expected = state.tokenHash;
  const match =
    supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(expected, 'utf8'));
  if (!match) {
    registerFailedAttempt(state);
    appendMissionAudit({ actorType: 'system', action: 'owner.setup_token_rejected' });
    throw new MissionAuthError(403, 'this setup link is not valid', 'forbidden');
  }
  const email = configuredMissionOwnerEmail();
  if (!email) {
    throw new MissionAuthError(400, 'ZA141251SA_OWNER_EMAIL is not configured', 'validation_error');
  }
  const password = String(input.password ?? '');
  if (password.length < 12) {
    // Not an attempt against the token — do not burn it for a weak password.
    throw new MissionAuthError(400, 'the owner password must be at least 12 characters', 'validation_error');
  }
  provisionOwner({ email, password });
  const identityLock = enforceIdentityLock();
  // Mark consumed rather than delete: the setup page needs a short grace
  // window to finish its post-reload verification. The token itself is dead
  // from this moment (stateUsable() rejects a consumed record).
  writeState({ ...state, consumedAt: nowIso() });
  appendMissionAudit({
    actorType: 'system',
    action: 'owner.password_set_via_setup_link',
    subjectType: 'owner',
    subjectId: email,
    detail: { method: 'browser_setup_link' },
  });
  return { ok: true, email, identityLock };
}

// ── Post-setup verification report ───────────────────────────────────────────
// The setup page runs a real authentication journey in the operator's browser
// and posts back a fixed set of boolean outcomes. Only known check ids are
// accepted and only booleans are stored, so nothing free-form (and therefore
// nothing secret) can ever reach the report file.

export const VERIFICATION_CHECKS = [
  'password_set',
  'owner_login',
  'session_persists_across_reload',
  'logout_clears_session',
  'foreign_identity_denied',
  'wrong_password_denied',
] as const;

export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

/**
 * A verification report is only accepted from a client that actually held a
 * mission session minted in the last 30 minutes — revoked or not, so the
 * post-logout report still counts. Without this, anyone could POST a green
 * report and manufacture evidence.
 */
export function attestRecentSession(token: string | null): boolean {
  if (!token) return false;
  const row = missionDb.get<Row>(
    `SELECT s.created_at AS created_at
       FROM mission_sessions s
       JOIN mission_owner o ON o.id = s.owner_id
      WHERE s.token_hash = ? AND lower(o.email) = ?`,
    [sha256(token), (configuredMissionOwnerEmail() ?? '').toLowerCase()],
  );
  if (!row) return false;
  const createdAt = Date.parse(String(row.created_at ?? ''));
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt <= 30 * 60_000;
}

export function recordOwnerSetupVerification(results: Record<string, unknown>): Record<VerificationCheck, boolean | null> {
  const clean = {} as Record<VerificationCheck, boolean | null>;
  for (const key of VERIFICATION_CHECKS) {
    const value = results?.[key];
    clean[key] = typeof value === 'boolean' ? value : null;
  }
  const file = verificationReportPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ recordedAt: nowIso(), owner: maskedOwnerEmail(), checks: clean }, null, 2),
    { mode: 0o600 },
  );
  appendMissionAudit({
    actorType: 'system',
    action: 'owner.setup_verification_recorded',
    detail: clean as unknown as Record<string, unknown>,
  });
  return clean;
}
