import { Router } from 'express';
import { register, login, logout, validateRefreshToken, rotateRefreshSession, AuthUserView } from '../auth';
import { signAccessToken, hashPassword } from '../security';
import { asyncRoute, HttpError } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import {
  appendAuditLog,
  findUserById,
  getAvailableCredits,
  getCreditAccount,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
  markEmailVerified,
  setUserPasswordHash,
  db,
} from '../db';
import { sendEmail, smtpConfigured, EmailDeliveryNotConfiguredError } from '../integrations/smtp';
import { env } from '../config/env';
import { redactSecrets } from '../config/secrets';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const user = await register({
      email: requireString(body, 'email', 'email'),
      password: requireString(body, 'password', 'password'),
      name: optionalString(body, 'name'),
    });
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const result = await login({
      email: requireString(body, 'email', 'email'),
      password: requireString(body, 'password', 'password'),
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(200).json(result);
  }),
);

authRouter.get(
  '/me',
  (req, res, next) => {
    const tokenHeader = req.header('authorization') ?? '';
    const token = tokenHeader.startsWith('Bearer ') ? tokenHeader.slice('Bearer '.length) : '';
    const userId = validateRefreshToken(token);
    if (!userId) {
      next(new HttpError(401, 'invalid or expired refresh token', 'unauthorized'));
      return;
    }
    const user = findUserById(userId);
    if (!user) {
      next(new HttpError(404, 'user not found', 'not_found'));
      return;
    }
    res.status(200).json({ user: toMeView(user) });
  },
);

authRouter.post(
  '/refresh',
  (req, res, next) => {
    const body = getBody(req);
    const refreshToken = requireString(body, 'refresh_token', 'refresh_token');
    const userId = validateRefreshToken(refreshToken);
    if (!userId) {
      next(new HttpError(401, 'invalid or expired refresh token', 'unauthorized'));
      return;
    }
    const { refreshToken: nextRefresh, sessionId, user } = rotateRefreshSession(userId, refreshToken);
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role, sid: sessionId });
    res.status(200).json({ accessToken, refreshToken: nextRefresh, user });
  },
);

authRouter.post(
  '/logout',
  (req, res) => {
    const body = getBody(req);
    const refreshToken = requireString(body, 'refresh_token', 'refresh_token');
    logout(refreshToken);
    const userId = validateRefreshToken(refreshToken);
    if (userId) {
      appendAuditLog({
        actorId: userId,
        action: 'auth.logout',
        resourceType: 'session',
        description: 'user logged out',
      });
    }
    res.status(204).send();
  },
);

authRouter.post(
  '/request-password-reset',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const email = requireString(body, 'email', 'email').trim().toLowerCase();
    const user = findUserById(findIdByEmail(email) ?? '');
    const emailConfigured = smtpConfigured();
    if (process.env.NODE_ENV === 'production' && !emailConfigured) {
      throw new HttpError(
        503,
        'email delivery requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD',
        'provider_not_configured',
        { requiredCredential: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] },
      );
    }

    const devToken = process.env.NODE_ENV !== 'production' && user ? createAuthToken({ userId: user.id, purpose: 'password_reset', ip: req.ip ?? null }).token : null;

    if (user && emailConfigured) {
      const reset = createAuthToken({ userId: user.id, purpose: 'password_reset', ip: req.ip ?? null });
      const resetUrl = `${env.publicWebUrl.replace(/\/$/, '')}/#/reset-password?token=${encodeURIComponent(reset.token)}`;
      try {
        await sendEmail({
          to: user.email,
          subject: 'AKBARAL password reset',
          text: `You requested a password reset.\n\nUse this link to set a new password (expires in 30 minutes):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        });
      } catch (error) {
        if (error instanceof EmailDeliveryNotConfiguredError) {
          throw new HttpError(503, error.message, 'provider_not_configured', { requiredCredential: error.requiredCredential });
        }
        throw new HttpError(502, 'email delivery failed; no secret or credential was logged', 'email_delivery_failed', { detail: redactSecrets(error instanceof Error ? error.message : String(error)) });
      }
    }

    res.status(202).json({
      status: 'requested',
      emailDelivery: emailConfigured ? 'configured' : 'not_configured',
      emailDeliveryRequired: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'],
      // Only present in development/test environments.
      ...(devToken ? { devToken } : {}),
    });
  }),
);

authRouter.post(
  '/reset-password',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const token = requireString(body, 'token', 'token');
    const password = requireString(body, 'password', 'password');
    if (password.length < 8) {
      throw new HttpError(400, 'password must be at least 8 characters', 'validation_error');
    }
    const verified = verifyAuthToken(token, 'password_reset');
    if (!verified) {
      throw new HttpError(400, 'invalid or expired reset token', 'invalid_token');
    }
    const passwordHash = await hashPassword(password);
    setUserPasswordHash(verified.userId, passwordHash);
    consumeAuthToken(verified.tokenId);
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [new Date().toISOString(), verified.userId]);
    appendAuditLog({ actorId: verified.userId, action: 'auth.password.reset', resourceType: 'user', resourceId: verified.userId, description: 'password reset from token' });
    res.status(200).json({ status: 'password_reset_successful' });
  }),
);

authRouter.post(
  '/request-email-verification',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const email = requireString(body, 'email', 'email').trim().toLowerCase();
    const user = findUserById(findIdByEmail(email) ?? '');
    const emailConfigured = smtpConfigured();
    if (process.env.NODE_ENV === 'production' && !emailConfigured) {
      throw new HttpError(
        503,
        'email delivery requires SMTP_HOST, SMTP_USER and SMTP_PASSWORD',
        'provider_not_configured',
        { requiredCredential: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] },
      );
    }
    const devToken = process.env.NODE_ENV !== 'production' && user ? createAuthToken({ userId: user.id, purpose: 'email_verify', ip: req.ip ?? null }).token : null;

    if (user && emailConfigured) {
      const verification = createAuthToken({ userId: user.id, purpose: 'email_verify', ip: req.ip ?? null });
      const verifyUrl = `${env.publicWebUrl.replace(/\/$/, '')}/#/verify-email?token=${encodeURIComponent(verification.token)}`;
      try {
        await sendEmail({
          to: user.email,
          subject: 'Verify your AKBARAL email address',
          text: `Welcome to AKBARAL.\n\nVerify your email address (expires in 30 minutes):\n${verifyUrl}`,
        });
      } catch (error) {
        if (error instanceof EmailDeliveryNotConfiguredError) {
          throw new HttpError(503, error.message, 'provider_not_configured', { requiredCredential: error.requiredCredential });
        }
        throw new HttpError(502, 'email delivery failed; no secret or credential was logged', 'email_delivery_failed', { detail: redactSecrets(error instanceof Error ? error.message : String(error)) });
      }
    }

    res.status(202).json({
      status: 'requested',
      emailDelivery: emailConfigured ? 'configured' : 'not_configured',
      emailDeliveryRequired: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'],
      ...(devToken ? { devToken } : {}),
    });
  }),
);

authRouter.post(
  '/verify-email',
  (req, res) => {
    const body = getBody(req);
    const token = requireString(body, 'token', 'token');
    const verified = verifyAuthToken(token, 'email_verify');
    if (!verified) {
      throw new HttpError(400, 'invalid or expired verification token', 'invalid_token');
    }
    markEmailVerified(verified.userId);
    consumeAuthToken(verified.tokenId);
    appendAuditLog({ actorId: verified.userId, action: 'auth.email.verified', resourceType: 'user', resourceId: verified.userId, description: 'email verified' });
    res.status(200).json({ status: 'email_verified' });
  },
);

function findIdByEmail(email: string): string | null {
  const row = db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  return row?.id ?? null;
}

function toMeView(user: NonNullable<ReturnType<typeof findUserById>>): AuthUserView {
  const account = getCreditAccount(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    freeCredits: account ? getAvailableCredits(account) : 0,
    createdAt: user.created_at,
  };
}
