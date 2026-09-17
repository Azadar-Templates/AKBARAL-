import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, smtpConfigured, EmailDeliveryNotConfiguredError } from './smtp';

const saved = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_SECURE'].map((key) => [key, process.env[key]] as const);

describe('SMTP integration', () => {
  it('fails honestly when SMTP is not configured', async () => {
    for (const [key] of saved) {
      delete process.env[key];
    }
    try {
      assert.equal(smtpConfigured(), false);
      await assert.rejects(
        () => sendEmail({ to: 'user@example.com', subject: 'test', text: 'test' }),
        (error: unknown) => error instanceof EmailDeliveryNotConfiguredError && error.code === 'email_delivery_not_configured',
      );
    } finally {
      for (const [key, value] of saved) {
        if (value !== undefined) {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      }
    }
  });
});
