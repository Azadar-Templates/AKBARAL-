'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import styles from './auth-card.module.css';
import { clearStoredTokens } from './app-shell';

type AuthMode = 'signin' | 'signup';
type Provider = { key?: string; label?: string; configured?: boolean };

type ProvidersPayload = { providers?: Provider[] };
type LoginPayload = { accessToken?: string; refreshToken?: string; user?: { email?: string; name?: string | null } };

export function AuthCard({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ state: 'error' | 'success'; message: string } | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const isSignup = mode === 'signup';
  const title = isSignup ? 'Create account' : 'Sign in';
  const subtitle = isSignup ? 'Start with email and password, or use a configured provider.' : 'Use your AKBARAL! account to open the workspace.';
  const oauthProviders = useMemo(
    () => providers.filter((provider) => (provider.key === 'google' || provider.key === 'github') && provider.configured),
    [providers],
  );

  useEffect(() => {
    let live = true;
    fetch('/api/auth/oauth/providers', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() as Promise<ProvidersPayload> : { providers: [] })
      .then((payload) => { if (live) setProviders(payload.providers ?? []); })
      .catch(() => { if (live) setProviders([]); });
    return () => { live = false; };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(cleanEmail)) { setFeedback({ state: 'error', message: 'Enter a valid email address.' }); return; }
    if (password.length < 8) { setFeedback({ state: 'error', message: 'Passwords need at least 8 characters.' }); return; }
    setBusy(true);
    try {
      if (isSignup) {
        const created = await fetch('/api/auth/register', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password }),
        });
        if (!created.ok) throw new Error(await errorMessage(created));
        setFeedback({ state: 'success', message: 'Account created. Sign in with the same email and password.' });
        window.setTimeout(() => { window.location.href = '/signin'; }, 900);
        return;
      }
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const payload = await response.json() as LoginPayload;
      clearStoredTokens();
      if (payload.accessToken) window.localStorage.setItem('ak_access', payload.accessToken);
      if (payload.refreshToken) window.localStorage.setItem('ak_refresh', payload.refreshToken);
      window.location.href = '/chat';
    } catch (cause) {
      setFeedback({ state: 'error', message: cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const startOAuth = (provider: Provider) => {
    if (!provider.key) return;
    window.location.href = `/api/auth/oauth/${encodeURIComponent(provider.key)}/authorize`;
  };

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <header className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">A!</span>
          <b>AKBARAL!</b>
          <p>One Intelligence. Every Solution.</p>
        </header>
        <div className={styles.head}>
          <h1 id="auth-title">{title}</h1>
          <p>{subtitle}</p>
        </div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className={styles.field}>Password
            <input type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {feedback ? <p className={styles.feedback} data-state={feedback.state} role="status">{feedback.message}</p> : null}
          <button className={styles.submit} type="submit" disabled={busy}>{busy ? 'Working…' : title}</button>
        </form>
        {oauthProviders.length ? (
          <div className={styles.oauth}>
            <div className={styles.divider}>Or continue with</div>
            <div className={styles.oauthGrid}>
              {oauthProviders.map((provider) => <button key={provider.key} type="button" onClick={() => startOAuth(provider)}>{provider.label || provider.key}</button>)}
            </div>
          </div>
        ) : null}
        <div className={styles.switch}>
          {isSignup ? <span>Already have an account? <Link href="/signin">Sign in</Link></span> : <span>No account yet? <Link href="/signup">Create one</Link></span>}
          <Link className={styles.back} href="/">Back to landing</Link>
        </div>
        <p className={styles.fine}>Authentication uses the existing AKBARAL! password and configured-provider endpoints.</p>
      </section>
    </main>
  );
}

async function errorMessage(response: Response) {
  const payload: unknown = await response.json().catch(() => ({}));
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === 'string') return nested.message;
    }
  }
  return 'Request failed. Please try again.';
}
