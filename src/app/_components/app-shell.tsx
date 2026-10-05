'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './app-shell.module.css';

type Account = {
  id?: string;
  email?: string;
  name?: string | null;
  role?: string;
  status?: string;
  freeCredits?: number;
};

type MePayload = {
  user?: Account;
  unlimited?: boolean;
  trial?: unknown;
  subscription?: unknown;
};

const NAV_ITEMS = [
  { href: '/chat', label: 'Chat', short: 'C' },
  { href: '/work', label: 'Task', short: 'T' },
  { href: '/pricing', label: 'See plans and pricing', short: '$' },
] as const;

const OTHER_NAV_ITEMS = [
  { href: '/files', label: 'Files & documents', short: 'F' },
  { href: '/images', label: 'Images', short: 'I' },
  { href: '/projects', label: 'Projects', short: 'P' },
  { href: '/agents', label: 'Agents', short: 'A' },
  { href: '/automations', label: 'Automations', short: 'Au' },
  { href: '/dashboard', label: 'Dashboard', short: 'D' },
  { href: '/settings', label: 'Settings', short: 'S' },
  { href: '/help', label: 'Help', short: '?' },
  { href: '/billing', label: 'Billing & credits', short: 'B' },
] as const;

export function storedAccessToken() {
  if (typeof window === 'undefined') return '';
  try { return window.localStorage.getItem('ak_access') ?? ''; } catch { return ''; }
}

export function storedRefreshToken() {
  if (typeof window === 'undefined') return '';
  try { return window.localStorage.getItem('ak_refresh') ?? ''; } catch { return ''; }
}

export function clearStoredTokens() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('ak_access');
    window.localStorage.removeItem('ak_refresh');
  } catch {}
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const hasBody = typeof init.body !== 'undefined';
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (hasBody && !isForm && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const token = storedAccessToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = readErrorMessage(payload) || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function readErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }
  return '';
}

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiJson<MePayload>('/api/me')
      .then((payload) => {
        if (!live) return;
        setAccount(payload.user ?? null);
        setAuthenticated(Boolean(payload.user));
        setError('');
      })
      .catch((cause) => {
        if (!live) return;
        setAccount(null);
        setAuthenticated(false);
        setError(cause instanceof Error ? cause.message : 'Session unavailable.');
      });
    return () => { live = false; };
  }, []);

  return { account, authenticated, error };
}

/**
 * `chrome='focus'` is used by the agent session page: it hides the global
 * workspace nav so the page can own its own left rail, and lets the content
 * area run full-bleed. Every other surface keeps the default chrome, so this
 * prop changes nothing anywhere it is not passed.
 */
export function AppShell({ title, children, allowAnonymous = false, chrome = 'full' }: { title: string; children: ReactNode; allowAnonymous?: boolean; chrome?: 'full' | 'focus' }) {
  const pathname = usePathname() || '/';
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const { account, authenticated } = useAccount();
  const initials = useMemo(() => (account?.name || account?.email || 'A').slice(0, 1).toUpperCase(), [account]);
  const role = account?.role || '';
  const canOwner = ['owner', 'super_admin'].includes(role);
  const canAdmin = ['admin', 'super_admin'].includes(role);

  // Workspace navigation is a real drawer below the desktop breakpoint: Escape
  // closes it and Tab stays inside while it is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = sidebar.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea');
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    sidebar.addEventListener('keydown', onKeyDown);
    return () => sidebar.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const signOut = async () => {
    const refreshToken = storedRefreshToken();
    try {
      if (refreshToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      }
    } catch {}
    clearStoredTokens();
    window.location.href = '/signin';
  };

  if (authenticated === null && !allowAnonymous) {
    return <main className={styles.state}><div className={styles.stateCard}><span className={styles.mark}>A!</span><p>Opening AKBARAL!</p></div></main>;
  }

  if (authenticated === false && !allowAnonymous) {
    return (
      <main className={styles.state}>
        <div className={styles.stateCard}>
          <span className={styles.mark}>A!</span>
          <h1>Sign in</h1>
          <p>This workspace surface is private to your account.</p>
          <Link href="/signin">Continue to sign in</Link>
          <Link className={styles.ghostButton} href="/">Back to landing</Link>
        </div>
      </main>
    );
  }

  const focus = chrome === 'focus';

  return (
    <main className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ''} ${focus ? styles.shellFocus : ''}`}>
      {mobileOpen && !focus ? <button className={styles.scrim} type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
      {focus ? null : <aside ref={sidebarRef} className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`} aria-label="Workspace navigation">
        <div className={styles.brandRow}>
          <Link className={styles.brand} href="/chat" aria-label="AKBARAL! workspace">
            <span className={styles.mark} aria-hidden="true">A!</span>
            <span className={styles.brandText}><b>AKBARAL!</b><small>One Intelligence. Every Solution.</small></span>
          </Link>
          <button className={styles.collapse} type="button" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed((value) => !value)}>{collapsed ? '›' : '‹'}</button>
        </div>
        <nav className={styles.nav} aria-label="Primary workspace navigation">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} onClick={() => setMobileOpen(false)}>
              <span className={styles.navBullet} aria-hidden="true">{item.short}</span>
              <span className={styles.navText}>{item.label}</span>
            </Link>
          ))}
          <div className={styles.navGroup}>
            <button
              className={styles.navGroupToggle}
              type="button"
              aria-expanded={othersOpen}
              aria-controls="sidebar-others-group"
              onClick={() => setOthersOpen((open) => !open)}
            >
              <span className={styles.navBullet} aria-hidden="true">…</span>
              <span className={styles.navText}>Others</span>
              <span className={styles.navChevron} aria-hidden="true">{othersOpen ? '▾' : '▸'}</span>
            </button>
            <div className={styles.navGroupItems} id="sidebar-others-group" hidden={!othersOpen}>
              {OTHER_NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} onClick={() => setMobileOpen(false)}>
                  <span className={styles.navBullet} aria-hidden="true">{item.short}</span>
                  <span className={styles.navText}>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>
      </aside>}

      <section className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.title}>
            {focus ? null : <button className={styles.mobileMenu} type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>☰</button>}
            <h1>{title}</h1>
          </div>
          <div className={styles.account}>
            {authenticated === false && allowAnonymous ? (
              <Link className={styles.primaryLink} href="/signin">Sign in</Link>
            ) : (
              <button className={styles.avatarButton} type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
                <span className={styles.avatar} aria-hidden="true">{initials}</span>
                <span className={styles.avatarName}>{account?.name || account?.email || 'Account'}</span>
              </button>
            )}
            {menuOpen ? (
              <nav className={styles.menu} aria-label="Account menu">
                <div className={styles.menuHead}><b>{account?.name || 'AKBARAL! account'}</b><small>{account?.email || 'Signed in'}</small></div>
                <Link href="/settings">Settings</Link>
                <Link href="/billing">Billing &amp; credits</Link>
                <Link href="/help">Help</Link>
                {canOwner ? <Link href="/owner">Owner</Link> : null}
                {canAdmin ? <Link href="/admin">Admin</Link> : null}
                <button type="button" onClick={() => void signOut()}>Log out</button>
              </nav>
            ) : null}
          </div>
        </header>
        <div className={`${styles.content} ${focus ? styles.contentFlush : ''}`}>
          <div className={`${styles.contentInner} ${focus ? styles.contentInnerFlush : ''}`}>{children}</div>
        </div>
      </section>
    </main>
  );
}

export const shellStyles = styles;
