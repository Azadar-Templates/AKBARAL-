'use client';

import { useEffect, useState } from 'react';

/**
 * Feedback — wired to the real, existing backend:
 *   POST /api/feedback  (requires an account — Bearer token)
 *   GET  /api/feedback/mine
 *
 * The public page reads the product SPA's session token from storage
 * (same origin). No token → an honest gate: feedback is an in-product
 * channel for registered users; anonymous visitors are directed to the
 * contact page. Nothing pretends to be submitted.
 */

interface MyFeedback {
  id: string;
  type: string;
  subject: string;
  status: string;
  created_at: string;
}

export function FeedbackForm() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MyFeedback[]>([]);

  useEffect(() => {
    setToken(localStorage.getItem('ak_access'));
    setChecked(true);
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch('/api/feedback/mine', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { feedback?: MyFeedback[] } | null) => {
        if (data?.feedback) setMine(data.feedback.slice(0, 10));
      })
      .catch(() => {
        /* history is progressive enhancement */
      });
  }, [token]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState('sending');
    setError(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: String(data.get('type') ?? 'feedback'),
          subject: String(data.get('subject') ?? ''),
          body: String(data.get('body') ?? ''),
        }),
      });
      if (response.status === 201) {
        setState('sent');
        form.reset();
        const refreshed = await fetch('/api/feedback/mine', { headers: { authorization: `Bearer ${token}` } });
        if (refreshed.ok) {
          const data2 = (await refreshed.json()) as { feedback?: MyFeedback[] };
          if (data2.feedback) setMine(data2.feedback.slice(0, 10));
        }
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(body.error?.message ?? `Submission failed (${response.status}).`);
      setState('error');
    } catch {
      setError('Network error — please try again.');
      setState('error');
    }
  }

  if (!checked) {
    return <p className="agx-state" role="status">Loading…</p>;
  }

  if (!token) {
    return (
      <div className="ctc-gate" role="status">
        <h3>Feedback is an in-product channel</h3>
        <p>
          Product feedback, bug reports and feature requests are tied to your account so we
          can follow up and show you the status of each submission. Please sign in first —
          or use the <a href="/contact">contact form</a> if you prefer to stay anonymous.
        </p>
        <div className="ctc-gate-actions">
          <a className="pk-btn pk-btn-primary" href="/#/login">Open the app and sign in</a>
          <a className="pk-btn pk-btn-ghost" href="/contact">Anonymous contact instead</a>
        </div>
      </div>
    );
  }

  return (
    <div className="fbk-wrap">
      {state === 'sent' && (
        <div className="ctc-ok" role="status">
          <h3>Feedback submitted</h3>
          <p>Thank you. Your submission is stored with your account and appears below with its review status.</p>
        </div>
      )}
      <form className="ctc-form" onSubmit={onSubmit}>
        <label>
          Type
          <select name="type" defaultValue="feedback">
            <option value="feedback">General feedback</option>
            <option value="bug">Bug report</option>
            <option value="feature">Feature request</option>
            <option value="abuse">Abuse report</option>
          </select>
        </label>
        <label>
          Subject
          <input name="subject" required maxLength={200} />
        </label>
        <label>
          Details
          <textarea name="body" required maxLength={10000} rows={6} placeholder="What happened, what you expected, and anything that helps us reproduce it." />
        </label>
        {error && <p className="ctc-error" role="alert">{error}</p>}
        <button className="pk-btn pk-btn-primary" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Submitting…' : 'Submit feedback'}
        </button>
      </form>

      {mine.length > 0 && (
        <section className="fbk-mine" aria-label="My submissions">
          <h3>Your recent submissions</h3>
          <ul>
            {mine.map((f) => (
              <li key={f.id}>
                <span className={`fbk-status fbk-${f.status}`}>{f.status}</span>
                <span className="fbk-subject">{f.subject}</span>
                <span className="fbk-type">{f.type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
