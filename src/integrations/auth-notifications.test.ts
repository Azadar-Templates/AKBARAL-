import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { notifyAuthEvent } from './auth-notifications';

const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PASSWORD'] as const;
const saved = new Map<string, string | undefined>();

before(() => { for (const key of keys) { saved.set(key, process.env[key]); delete process.env[key]; } });
after(() => { for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

describe('auth email notifications', () => {
  it('silently disables signup notices when any SMTP setting is absent', async () => {
    await assert.doesNotReject(() => notifyAuthEvent({ email: 'user@example.com', event: 'signup' }));
  });
  it('silently disables sign-in notices when any SMTP setting is absent', async () => {
    await assert.doesNotReject(() => notifyAuthEvent({ email: 'user@example.com', event: 'signin', provider: 'Google' }));
  });
});
