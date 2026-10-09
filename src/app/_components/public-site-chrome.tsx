'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './public-site-chrome.module.css';
import { BrandLogo, BrandMark } from './brand-mark';


const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About Us' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/team', label: 'Our Team' },
  { href: '/blog', label: 'Blogs' },
  { href: '/contact', label: 'Contact Us' },
] as const;

function isActive(pathname: string | null, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname?.startsWith(`${href}/`);
}

function NavLink({ href, label, onNavigate }: { href: string; label: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      className={styles.navLink}
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
    >
      {label}
    </Link>
  );
}

export function PublicSiteHeader() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      else triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = () => setOpen(false);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="AKBARAL! home">
            <span className={styles.mark} aria-hidden="true"><BrandMark size={21} /></span>
            <span className={styles.brandText}><b>AKBARAL!</b><small>One Intelligence. Every Solution.</small></span>
          </Link>
          <nav className={styles.desktopNav} aria-label="Public navigation">
            {NAV_ITEMS.map((item) => <NavLink key={item.href} {...item} />)}
          </nav>
          <div className={styles.actions}>
            <Link className={styles.signIn} href="/signin">Sign in</Link>
            <Link className={styles.trial} href="/signup">Start Free Trial</Link>
          </div>
          <button
            ref={triggerRef}
            className={styles.menuButton}
            type="button"
            aria-label={open ? 'Close public navigation' : 'Open public navigation'}
            aria-expanded={open}
            aria-controls="public-mobile-navigation"
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </header>
      {open ? <div className={styles.mobileLayer}>
        <button className={styles.scrim} type="button" aria-label="Close public navigation" onClick={close} />
        <aside id="public-mobile-navigation" ref={drawerRef} className={styles.drawer} aria-label="Public navigation" role="dialog" aria-modal="true">
          <div className={styles.drawerHead}><span>Navigate</span><button type="button" className={styles.closeButton} onClick={close} aria-label="Close public navigation">×</button></div>
          <nav className={styles.mobileNav}>
            {NAV_ITEMS.map((item) => <NavLink key={item.href} {...item} onNavigate={close} />)}
          </nav>
          <div className={styles.mobileActions}><Link className={styles.signIn} href="/signin" onClick={close}>Sign in</Link><Link className={styles.trial} href="/signup" onClick={close}>Start Free Trial</Link></div>
        </aside>
      </div> : null}
    </>
  );
}

export function PublicSiteFooter() {
  const year = new Date().getFullYear();
  return <footer className={styles.footer}>
    <div className={styles.footerInner}>
      <div className={styles.footerBrand}><BrandLogo className={styles.footerMark} decorative /><b>AKBARAL!</b><span>One Intelligence. Every Solution.</span></div>
      <nav className={styles.footerNav} aria-label="Footer navigation">
        {NAV_ITEMS.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
      </nav>
      <nav className={styles.legalNav} aria-label="Legal navigation"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/security">Security</Link></nav>
      <p className={styles.copyright}>©{year} AKBARAL! · All rights reserved.</p>
    </div>
  </footer>;
}
