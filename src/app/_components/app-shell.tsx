'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './app-shell.module.css';
import { BrandMark } from './brand-mark';


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

/** The one product inventory. Owner/Admin deliberately stay account-menu-only. */
const NAV_GROUPS = [
  { title: 'PRIMARY MODES', items: [
    { href: '/chat', label: 'Chat' },
    { href: '/work', label: 'Task' },
  ] },
  { title: 'WORKSPACE', items: [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/files', label: 'Files & documents' },
    { href: '/images', label: 'Images' },
    { href: '/projects', label: 'Projects' },
    { href: '/agents', label: 'Agents' },
    { href: '/agent-factory', label: 'Agent Factory' },
    { href: '/automations', label: 'Automations' },
  ] },
  { title: 'ACCOUNT', items: [
    { href: '/billing', label: 'Billing & credits' },
    { href: '/pricing', label: 'See plans and pricing' },
    { href: '/settings', label: 'Settings' },
    { href: '/help', label: 'Help' },
  ] },
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

function WorkspaceNavigation({ pathname, close, navRef, open }: {
  pathname: string;
  close: () => void;
  navRef: RefObject<HTMLElement | null>;
  open: boolean;
}) {
  return (
    <nav ref={navRef} id="workspace-navigation" className={styles.nav} data-open={open ? 'true' : undefined} aria-label="Workspace navigation">
      {NAV_GROUPS.map((group) => (
        <div className={styles.navGroup} key={group.title}>
          <span className={styles.navSectionTitle}>{group.title}</span>
          <div className={styles.navGroupItems}>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                onClick={close}
              >
                <span className={styles.navText}>{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * Authenticated application chrome. The header is intentionally the only
 * shared navigation surface: it is a desktop row, a horizontally scrollable
 * tablet strip, or a focus-trapped mobile drawer at the three release bands.
 */
export function AppShell({ title, children, allowAnonymous = false, viewportLocked = false }: { title: string; children: ReactNode; allowAnonymous?: boolean; viewportLocked?: boolean }) {
  const pathname = usePathname() || '/';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 12 });
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileRestoreRef = useRef<HTMLElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLElement>(null);
  const { account, authenticated } = useAccount();
  const initials = useMemo(() => (account?.name || account?.email || 'A').slice(0, 1).toUpperCase(), [account]);
  const role = account?.role || '';
  const canOwner = ['owner', 'super_admin'].includes(role);
  const canAdmin = ['admin', 'super_admin'].includes(role);

  const closeMobileNavigation = () => {
    const wasOpen = mobileOpen;
    setMobileOpen(false);
    if (!wasOpen) return;
    window.requestAnimationFrame(() => {
      const target = mobileRestoreRef.current;
      mobileRestoreRef.current = null;
      if (target && document.contains(target)) target.focus();
      else mobileMenuButtonRef.current?.focus();
    });
  };

  const openMobileNavigation = () => {
    mobileRestoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : mobileMenuButtonRef.current;
    setMobileOpen(true);
  };

  // The mobile navigation is a real drawer: focus moves into it, Escape and
  // the scrim close it, Tab wraps, and focus returns to the menu trigger.
  useEffect(() => {
    if (!mobileOpen) return;
    const nav = mobileNavRef.current;
    if (!nav) return;
    const focusable = () => [...nav.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea')];
    const focusFirst = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileNavigation();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    nav.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      nav.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  // The account menu remains portaled so viewport-locked Chat/Task content
  // cannot clip it. Its labels are deliberately nowrap and its minimum width
  // is enforced in CSS for the same reason.
  useEffect(() => {
    if (!menuOpen) return;
    const restoreFocus = () => {
      setMenuOpen(false);
      window.requestAnimationFrame(() => avatarButtonRef.current?.focus());
    };
    const positionMenu = () => {
      const trigger = avatarButtonRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        restoreFocus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!accountMenuRef.current?.contains(target) && !avatarButtonRef.current?.contains(target)) restoreFocus();
    };
    positionMenu();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    const focusFirstItem = window.requestAnimationFrame(() => {
      accountMenuRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      window.cancelAnimationFrame(focusFirstItem);
    };
  }, [menuOpen]);

  const closeAccountMenu = () => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => avatarButtonRef.current?.focus());
  };

  const toggleAccountMenu = () => {
    if (menuOpen) {
      closeAccountMenu();
      return;
    }
    const trigger = avatarButtonRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
    }
    setMenuOpen(true);
  };

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
    return <main className={styles.state}><div className={styles.stateCard}><span className={styles.mark} aria-hidden="true"><BrandMark size={22} /></span><p>Opening AKBARAL!</p></div></main>;
  }

  if (authenticated === false && !allowAnonymous) {
    return (
      <main className={styles.state}>
        <div className={styles.stateCard}>
          <span className={styles.mark} aria-hidden="true"><BrandMark size={22} /></span>
          <h1>Sign in</h1>
          <p>This workspace surface is private to your account.</p>
          <Link href="/signin">Continue to sign in</Link>
          <Link className={styles.ghostButton} href="/">Back to landing</Link>
        </div>
      </main>
    );
  }

  return (
    <main className={`${styles.shell} ${viewportLocked ? `${styles.shellViewportLocked} akbaral-viewport-locked` : ''}`}>
      {mobileOpen ? <button className={styles.scrim} type="button" aria-label="Close navigation" onClick={closeMobileNavigation} /> : null}
      <section className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.headerPrimary}>
            <div className={styles.title}>
              <Link className={styles.brand} href="/chat" aria-label="AKBARAL! workspace">
                <span className={styles.mark} aria-hidden="true"><BrandMark size={22} /></span>
                <span className={styles.brandText}><b>AKBARAL!</b><small>One Intelligence. Every Solution.</small></span>
              </Link>
              <h1>{title}</h1>
            </div>
            <button ref={mobileMenuButtonRef} className={styles.mobileMenu} type="button" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileOpen} onClick={openMobileNavigation}>☰</button>
            <div className={styles.account}>
              {authenticated === false && allowAnonymous ? (
                <Link className={styles.primaryLink} href="/signin">Sign in</Link>
              ) : (
                <button ref={avatarButtonRef} className={styles.avatarButton} type="button" aria-controls="account-menu" aria-expanded={menuOpen} onClick={toggleAccountMenu}>
                  <span className={styles.avatar} aria-hidden="true">{initials}</span>
                  <span className={styles.avatarName}>{account?.name || account?.email || 'Account'}</span>
                </button>
              )}
              {menuOpen && typeof document !== 'undefined' ? createPortal(
                <nav ref={accountMenuRef} id="account-menu" className={styles.menu} style={{ top: menuPosition.top, right: menuPosition.right }} aria-label="Account menu">
                  <div className={styles.menuHead}><b>{account?.name || 'AKBARAL! account'}</b><small>{account?.email || 'Signed in'}</small></div>
                  <Link href="/settings" onClick={closeAccountMenu}>Settings</Link>
                  <Link href="/billing" onClick={closeAccountMenu}>Billing &amp; credits</Link>
                  <Link href="/help" onClick={closeAccountMenu}>Help</Link>
                  {canOwner ? <Link href="/owner" onClick={closeAccountMenu}>Owner</Link> : null}
                  {canOwner ? <Link href="/mission-gateway/" aria-current={pathname.startsWith('/mission-gateway') ? 'page' : undefined} onClick={closeAccountMenu}>Mission Control</Link> : null}
                  {canAdmin ? <Link href="/admin" onClick={closeAccountMenu}>Admin</Link> : null}
                  <button type="button" onClick={() => { closeAccountMenu(); void signOut(); }}>Log out</button>
                </nav>,
                document.body,
              ) : null}
            </div>
          </div>
          <WorkspaceNavigation pathname={pathname} close={closeMobileNavigation} navRef={mobileNavRef} open={mobileOpen} />
        </header>
        <div className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </div>
      </section>
    </main>
  );
}

export const shellStyles = styles;
