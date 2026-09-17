import { Router } from 'express';
import { appendAuditLog, createFeedback, createUser, findUserByEmail } from '../db';
import { asyncRoute, HttpError } from '../server/http';
import { getBody, requireString } from '../server/middleware/validation';

/**
 * Public contact form (Phase 2).
 *
 * Architecture decision (no production schema changes): anonymous contact
 * submissions are persisted through the EXISTING feedback system under a
 * dedicated system account (`contact-form@akbaral.ai`). That means:
 *   - real persistence in the audited feedback table
 *   - real admin visibility through the existing admin feedback surface
 *     (GET /api/trust/admin/feedback, status workflow, admin notes)
 *   - zero migrations on production Neon
 *
 * Anti-abuse: strict validation, length caps, a honeypot field, and a
 * dedicated rate limit applied at mount time (5/minute, see app.ts).
 *
 * Body: { name, email, subject, message, company? } — `company` is the
 * honeypot: real users never fill it; bots that do get a plain 400.
 */

const SYSTEM_CONTACT_EMAIL = 'contact-form@akbaral.ai';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let systemUserId: string | null = null;

function resolveSystemContactUser(): string {
  if (systemUserId) {
    return systemUserId;
  }
  const existing = findUserByEmail(SYSTEM_CONTACT_EMAIL);
  if (existing) {
    systemUserId = String(existing.id);
    return systemUserId;
  }
  const created = createUser({
    email: SYSTEM_CONTACT_EMAIL,
    name: 'Contact Form (system)',
    status: 'active',
    passwordHash: null,
  });
  systemUserId = String(created.id);
  return systemUserId;
}

export function createContactRouter(): Router {
  const router = Router();

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = getBody(req);

      // Honeypot: hidden field that humans leave empty.
      if (typeof body.company === 'string' && body.company.trim().length > 0) {
        throw new HttpError(400, 'request rejected', 'validation_error');
      }

      const name = requireString(body, 'name', 'name').trim().slice(0, 100);
      const email = requireString(body, 'email', 'email').trim().slice(0, 200);
      if (!EMAIL_PATTERN.test(email)) {
        throw new HttpError(400, 'email must be a valid address', 'validation_error');
      }
      const subject = requireString(body, 'subject', 'subject').trim().slice(0, 200);
      const message = requireString(body, 'message', 'message').trim().slice(0, 10_000);
      if (message.length < 10) {
        throw new HttpError(400, 'message must be at least 10 characters', 'validation_error');
      }

      const userId = resolveSystemContactUser();
      const created = createFeedback({
        userId,
        type: 'feedback',
        subject: `[contact] ${subject}`,
        body: `From: ${name} <${email}>\n\n${message}`,
      });

      appendAuditLog({
        actorId: userId,
        action: 'contact.received',
        resourceType: 'feedback',
        resourceId: created.id,
        description: `contact form submission from ${email}`,
      });

      res.status(201).json({ received: true, reference: String(created.id).slice(-8) });
    }),
  );

  router.get(
    '/health',
    asyncRoute(async (_req, res) => {
      res.status(200).json({ ok: true, endpoint: 'contact' });
    }),
  );

  return router;
}

// Keep the module-level user cache honest if a test database resets.
export function resetContactSystemUserCache(): void {
  systemUserId = null;
}

// Direct DB accessor for tests.
export function contactSystemUserId(): string | null {
  return systemUserId;
}
