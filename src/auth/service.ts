import {
  createUser,
  findUserByEmail,
  findUserById,
  getCreditAccount,
  updateUserLastLogin,
  createSession,
  findSessionByTokenHash,
  revokeSession,
  rotateSessionLastSeen,
  appendSecurityLog,
  appendAuditLog,
} from '../db';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  newBearerToken,
  signAccessToken,
} from '../security';
import { UserStatus } from '../db/constants';
import { HttpError } from '../server/http';

export interface AuthUserView {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  freeCredits: number;
  createdAt: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginOutput {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUserView;
}

function toUserView(user: Awaited<ReturnType<typeof findUserById>>): AuthUserView {
  if (!user) {
    throw new HttpError(404, 'user not found', 'not_found');
  }
  const account = getCreditAccount(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    freeCredits: account?.free_credits ?? 0,
    createdAt: user.created_at,
  };
}

export async function register(input: RegisterInput): Promise<AuthUserView> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'invalid email', 'validation_error');
  }
  if (!input.password || input.password.length < 8) {
    throw new HttpError(400, 'password must be at least 8 characters', 'validation_error');
  }
  if (findUserByEmail(email)) {
    throw new HttpError(409, 'email already registered', 'conflict');
  }

  const passwordHash = await hashPassword(input.password);
  const user = createUser({
    email,
    name: input.name?.trim() || null,
    role: 'user',
    status: 'active',
    passwordHash,
    metadata: { signup: true, phase: 'foundation' },
  });

  appendAuditLog({
    actorId: user.id,
    action: 'auth.register',
    resourceType: 'user',
    resourceId: user.id,
    description: 'new user registered',
    metadata: { email },
  });

  return toUserView(user);
}

export async function login(input: { email: string; password: string; ipAddress?: string | null; userAgent?: string | null }): Promise<LoginOutput> {
  const email = input.email.trim().toLowerCase();
  const user = findUserByEmail(email);

  if (!user || !user.password_hash) {
    appendSecurityLog({
      eventType: 'auth.login.failed',
      severity: 'warning',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      description: 'login failed: invalid credentials',
      metadata: { email },
    });
    throw new HttpError(401, 'invalid email or password', 'invalid_credentials');
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    appendSecurityLog({
      userId: user.id,
      eventType: 'auth.login.failed',
      severity: 'warning',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      description: 'login failed: invalid password',
      metadata: { email },
    });
    throw new HttpError(401, 'invalid email or password', 'invalid_credentials');
  }

  if (user.status !== UserStatus.ACTIVE) {
    appendSecurityLog({
      userId: user.id,
      eventType: 'auth.login.blocked',
      severity: 'critical',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      description: 'login blocked: account not active',
      metadata: { status: user.status },
    });
    throw new HttpError(403, 'account is not active', 'account_not_active');
  }

  const now = Date.now();
  const refreshToken = newBearerToken();
  const session = createSession({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  updateUserLastLogin(user.id, new Date(now).toISOString());

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    sid: session.id,
  });

  appendSecurityLog({
    userId: user.id,
    eventType: 'auth.login.success',
    severity: 'info',
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    description: 'login succeeded',
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 60 * 60,
    user: toUserView(user),
  };
}

/**
 * Validate a refresh-token-style opaque session id.
 * Returns the user id when the session is present, active and not expired.
 */
export function validateRefreshToken(refreshToken: string): string | null {
  const session = findSessionByTokenHash(hashToken(refreshToken));
  if (!session || session.revoked_at) {
    return null;
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }
  rotateSessionLastSeen(session.id);
  return session.user_id;
}

/**
 * Rotate a refresh token: revoke old, mint a new one for the same user.
 */
export function rotateRefreshSession(userId: string, previousRefreshToken?: string): { refreshToken: string; sessionId: string; user: AuthUserView } {
  const user = findUserById(userId);
  if (!user) {
    throw new HttpError(404, 'user not found', 'not_found');
  }
  if (previousRefreshToken) {
    const previous = findSessionByTokenHash(hashToken(previousRefreshToken));
    if (previous) {
      revokeSession(previous.id);
    }
  }
  const refreshToken = newBearerToken();
  const session = createSession({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return { refreshToken, sessionId: session.id, user: toUserView(user) };
}

export function logout(refreshToken: string): void {
  const session = findSessionByTokenHash(hashToken(refreshToken));
  if (session) {
    revokeSession(session.id);
  }
}
