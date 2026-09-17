import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * AKBARAL! public-site chrome (Phase 1).
 *
 * Server-rendered header/footer for the marketing and documentation pages.
 * Uses the shared design tokens (tokens.css) so the public site carries the
 * same obsidian/indigo identity as the product shell. Navigation exposes
 * only routes that exist — no dead links.
 */

const NAV = [
  { href: '/features', label: 'Platform' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/about', label: 'About' },
] as const;

export function SiteHeader({ currentPath }: { currentPath: string }) {
  return (
    <header className="pk-header">
      <div className="pk-header-bar">
        <Link href="/" className="pk-brand" aria-label="AKBARAL! home">
          <span className="pk-brand-mark" aria-hidden="true">A!</span>
          AKBARAL!
        </Link>
        <nav className="pk-nav" aria-label="Site navigation">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={currentPath === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="pk-header-actions">
          <a className="pk-btn pk-btn-ghost" href="/#/login">Log In</a>
          <a className="pk-btn pk-btn-primary" href="/#/register">Start Building</a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="pk-footer">
      <div className="pk-footer-inner">
        <div className="pk-footer-brand">
          <Link href="/" className="pk-brand">
            <span className="pk-brand-mark" aria-hidden="true">A!</span>
            AKBARAL!
          </Link>
          <p>One Intelligence. Every Solution. A universal AI operating platform:
            state a goal, and a coordinated system plans, executes with
            specialist agents, verifies, and delivers.</p>
        </div>
        <div>
          <h3>Platform</h3>
          <ul>
            <li><Link href="/features">Features</Link></li>
            <li><Link href="/pricing">Pricing</Link></li>
            <li><Link href="/security">Security</Link></li>
            <li><Link href="/about">About</Link></li>
          </ul>
        </div>
        <div>
          <h3>Product</h3>
          <ul>
            <li><a href="/#/dashboard">Dashboard</a></li>
            <li><a href="/#/master">MASTER</a></li>
            <li><a href="/#/agents">Agent World</a></li>
            <li><a href="/#/register">Create account</a></li>
          </ul>
        </div>
        <div>
          <h3>Support</h3>
          <ul>
            <li><Link href="/help">Help Center</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/documentation">Documentation</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><Link href="/feedback">Feedback</Link></li>
          </ul>
        </div>
        <div>
          <h3>Legal</h3>
          <ul>
            <li><Link href="/privacy">Privacy Policy</Link></li>
            <li><Link href="/terms">Terms of Service</Link></li>
          </ul>
        </div>
      </div>
      <div className="pk-footer-bottom">
        <div className="pk-footer-bottom-inner">
          <span>© 2026 AKBARAL!</span>
          <span>4,001 registered specialist agents · built for real execution</span>
        </div>
      </div>
    </footer>
  );
}

export function SitePage({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  return (
    <div className="pk-site">
      <a className="pk-skip" href="#pk-content">Skip to content</a>
      <SiteHeader currentPath={currentPath} />
      <main id="pk-content" className="pk-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
