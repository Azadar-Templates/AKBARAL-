import type { ReactNode } from 'react';

export function SiteHeader() {
  return null;
}

export function SiteFooter() {
  return null;
}

export function SitePage({ children }: { currentPath?: string; children: ReactNode }) {
  return <>{children}</>;
}
