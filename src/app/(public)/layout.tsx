import type { ReactNode } from 'react';
import './site.css';

/**
 * Layout for the public marketing/documentation site. The homepage (`/`)
 * keeps its own cinematic presentation; these pages share the SitePage
 * chrome (header/footer) and the pk-* design-token styles.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
