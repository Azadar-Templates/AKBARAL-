import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiServer, type ApiServer } from '../app';
import { db, findUserByEmail } from '../db';

/**
 * Public contact form (Phase 2) — real HTTP-surface tests.
 *
 * Verifies:
 *   - valid submissions persist (as feedback owned by the system contact
 *     account — the no-schema-change architecture)
 *   - validation rejects bad email / short message
 *   - the honeypot rejects bots
 *   - the dedicated rate limit kicks in (5/minute)
 *   - submissions are visible to admins through the EXISTING admin
 *     feedback surface
 *
 * Request budget: the contact limit is 5/min on this IP, so the tests
 * are ordered — 4 accepted/rejected posts, then the 5th/6th confirm 429.
 */
describe('Public contact form', () => {
  let api: ApiServer;
  let baseUrl = '';
  const suffix = randomBytes(4).toString('hex');
  const createdFeedbackIds: string[] = [];
  const adminEmail = `contact-admin-${suffix}@akbaral.test`;

  before(async () => {
    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    for (const id of createdFeedbackIds) {
      db.run('DELETE FROM feedback WHERE id = ?', [id]);
    }
    db.run('DELETE FROM users WHERE email = ?', [adminEmail]);
    await api.close();
  });

  function post(payload: Record<string, unknown>): Promise<Response> {
    return fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('persists a valid submission under the system contact account', async () => {
    const response = await post({
      name: 'Test Sender',
      email: 'sender@example.com',
      subject: `Hello ${suffix}`,
      message: 'This is a genuine contact message with enough detail to pass validation.',
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { received: boolean; reference: string };
    assert.equal(body.received, true);
    assert.ok(body.reference.length > 0);

    const systemUser = findUserByEmail('contact-form@akbaral.ai');
    assert.ok(systemUser, 'system contact account must exist');
    const row = db.get<{ id: string; subject: string; body: string; user_id: string }>(
      "SELECT id, subject, body, user_id FROM feedback WHERE subject = ?",
      [`[contact] Hello ${suffix}`],
    );
    assert.ok(row, 'contact submission must be persisted as feedback');
    assert.equal(String(row.user_id), String(systemUser!.id));
    assert.ok(row.body.includes('Test Sender <sender@example.com>'));
    createdFeedbackIds.push(row.id);
  });

  it('rejects an invalid email and a too-short message', async () => {
    const badEmail = await post({
      name: 'X', email: 'not-an-email', subject: 's', message: 'long enough message here ok',
    });
    assert.equal(badEmail.status, 400);

    const shortMessage = await post({
      name: 'X', email: 'ok@example.com', subject: 's', message: 'short',
    });
    assert.equal(shortMessage.status, 400);
  });

  it('rejects honeypot fills (bots)', async () => {
    const response = await post({
      name: 'Bot', email: 'bot@example.com', subject: 'spam', message: 'buy something now please', company: 'spammy-inc',
    });
    assert.equal(response.status, 400);
  });

  it('rate limits after 5 requests per minute', async () => {
    // 4 requests were spent above; the 5th may pass, the 6th must 429.
    const fifth = await post({
      name: 'Fifth', email: 'f@example.com', subject: `fifth ${suffix}`, message: 'fifth message with sufficient length.',
    });
    if (fifth.status === 201) {
      const body = (await fifth.json()) as { reference: string };
      const row = db.get<{ id: string }>('SELECT id FROM feedback WHERE subject = ?', [`[contact] fifth ${suffix}`]);
      if (row) createdFeedbackIds.push(row.id);
      void body;
    }
    const sixth = await post({
      name: 'Sixth', email: 's@example.com', subject: 'sixth', message: 'sixth message with sufficient length.',
    });
    assert.equal(sixth.status, 429);
  });

  it('makes contact submissions visible to admins via the existing feedback surface', async () => {
    // Wait out the contact rate-limit window? No — admin listing uses the
    // trust router (separate limits). Register + promote an admin.
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'correct-horse-battery-staple', name: 'Contact Admin' }),
    });
    assert.equal(reg.status, 201);
    const regBody = (await reg.json()) as { user: { id: string } };
    db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', regBody.user.id]);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'correct-horse-battery-staple' }),
    });
    assert.equal(login.status, 200);
    const { accessToken } = (await login.json()) as { accessToken: string };

    const listing = await fetch(`${baseUrl}/api/admin/feedback`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(listing.status, 200);
    const body = (await listing.json()) as { feedback: Array<{ subject: string }> };
    assert.ok(
      body.feedback.some((f) => f.subject === `[contact] Hello ${suffix}`),
      'contact submission must appear in the admin feedback queue',
    );
  });
});
