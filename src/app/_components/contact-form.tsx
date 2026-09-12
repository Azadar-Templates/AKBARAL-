'use client';

import { useState } from 'react';

/**
 * Public contact form — posts to the real /api/contact backend
 * (validated, rate-limited, persisted into the feedback system where
 * the team reviews it). Honest success / validation / rate-limit /
 * server-error states; no fake "sent" confirmation.
 */
export function ContactForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState('sending');
    setError(null);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') ?? ''),
          email: String(data.get('email') ?? ''),
          subject: String(data.get('subject') ?? ''),
          message: String(data.get('message') ?? ''),
          company: String(data.get('company') ?? ''), // honeypot
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (response.status === 201) {
        setState('sent');
        form.reset();
        return;
      }
      if (response.status === 429) {
        setError('Too many submissions — please wait a minute and try again.');
      } else if (response.status === 400) {
        setError(body.error?.message ?? 'Please check the form and try again.');
      } else {
        setError(`Submission failed (${response.status}). Please try again shortly.`);
      }
      setState('error');
    } catch {
      setError('Network error — check your connection and try again.');
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="ctc-ok" role="status">
        <h3>Message received</h3>
        <p>Thank you — your message is stored and queued for the team. If you left an email address, you will hear back there.</p>
        <button type="button" className="pk-btn pk-btn-ghost" onClick={() => setState('idle')}>Send another message</button>
      </div>
    );
  }

  return (
    <form className="ctc-form" onSubmit={onSubmit} noValidate>
      <div className="ctc-row">
        <label>
          Name
          <input name="name" required maxLength={100} autoComplete="name" />
        </label>
        <label>
          Email
          <input name="email" type="email" required maxLength={200} autoComplete="email" />
        </label>
      </div>
      <label>
        Subject
        <input name="subject" required maxLength={200} />
      </label>
      <label>
        Message
        <textarea name="message" required minLength={10} maxLength={10000} rows={7} />
      </label>
      {/* Honeypot — hidden from humans, catches bots. */}
      <div className="ctc-hp" aria-hidden="true">
        <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {error && <p className="ctc-error" role="alert">{error}</p>}
      <button className="pk-btn pk-btn-primary" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send message'}
      </button>
      <p className="ctc-note">Submissions are rate-limited and reviewed by the team. For security-sensitive reports, mention “security” in the subject.</p>
    </form>
  );
}
