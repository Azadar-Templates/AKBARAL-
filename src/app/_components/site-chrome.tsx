import Link from 'next/link';
import type { ReactNode } from 'react';

export function SiteHeader() {
  return <header className="pk-header"><div className="pk-header-bar"><Link href="/" className="pk-brand">AKBARAL!</Link><nav className="pk-nav" aria-label="Site navigation"><Link href="/#features">Features</Link><Link href="/#pricing">See plans and pricing</Link></nav><div className="pk-header-actions"><Link className="pk-btn pk-btn-ghost" href="/signin">Sign in</Link><Link className="pk-btn pk-btn-primary" href="/signup">Start Free Trial</Link></div></div></header>;
}

export function SiteFooter() {
  return <footer className="pk-footer"><div className="pk-footer-inner"><div className="pk-footer-brand"><Link href="/" className="pk-brand">AKBARAL!</Link><p>One Intelligence. Every Solution.</p></div><div><h3>Explore</h3><ul><li><Link href="/#features">Features</Link></li><li><Link href="/#pricing">Pricing</Link></li><li><Link href="/contact">Contact</Link></li></ul></div><div><h3>Trust</h3><ul><li><Link href="/privacy">Privacy</Link></li><li><Link href="/terms">Terms</Link></li><li><Link href="/security">Security</Link></li></ul></div></div><div className="pk-footer-bottom"><div className="pk-footer-bottom-inner"><span>© 2026 AKBARAL!</span><span>4,001 registered agent contracts · built for real execution</span></div></div></footer>;
}

export function SitePage({ children }: { children: ReactNode; currentPath?: string }) {
  return <div className="pk-site"><a className="pk-skip" href="#pk-content">Skip to content</a><SiteHeader /><main id="pk-content" className="pk-main">{children}</main><SiteFooter /></div>;
}
