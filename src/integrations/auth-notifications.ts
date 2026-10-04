import { sendEmail, smtpConfigured } from './smtp';

type AuthEvent = 'signup' | 'signin';

/** Best-effort account notices. Delivery can never change an auth result. */
export async function notifyAuthEvent(input: { email: string; event: AuthEvent; provider?: string }): Promise<void> {
  if (!smtpConfigured()) return;
  const now = new Date().toISOString();
  const subject = input.event === 'signup' ? 'Welcome to AKBARAL!' : 'New AKBARAL! sign-in';
  const via = input.provider ? ` via ${input.provider}` : '';
  const text = input.event === 'signup'
    ? `Welcome to AKBARAL!\n\nYour account was created for ${input.email} at ${now}.\n\nIf you did not create this account, please secure your email account.`
    : `A new sign-in to AKBARAL! was recorded${via} at ${now} UTC for ${input.email}.\n\nIf this was not you, secure your account and change your password.`;
  try {
    await sendEmail({ to: input.email, subject, text });
  } catch (error) {
    // Authentication remains successful; do not include SMTP responses or PII.
    console.warn('[akbaral] auth notification delivery failed; authentication continued');
  }
}
