import type { Metadata } from 'next';
import OwnerConsole from './owner-console';

export const metadata: Metadata = {
  title: 'Owner Console — AKBARAL!',
  description: 'Private business analytics console for the AKBARAL! platform owner.',
  // The console is a private operator surface: never indexed, never listed.
  robots: { index: false, follow: false },
};

/**
 * /owner — the AKBARAL! Owner Console.
 *
 * A private operator page (owner / super_admin only, enforced by the API, not
 * by hiding the route). It is deliberately not linked from the marketing
 * navigation or the workspace SPA, and it is excluded from the sitemap.
 */
export default function OwnerConsolePage() {
  return <OwnerConsole />;
}
