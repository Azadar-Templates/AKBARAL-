import type { Metadata } from 'next';
import Home from '../page';

export const metadata: Metadata = {
  title: 'Projects — AKBARAL!',
  description:
    'Your AKBARAL! projects, files and artifacts. A real route so the projects screen can be bookmarked and refreshed.',
  // An application surface: reachable and refreshable, never a marketing page.
  robots: { index: false, follow: false },
};

/**
 * /projects — a real route for the `projects` screen of the single-page application.
 *
 * WHY THIS ROUTE EXISTS: the application is hash-routed, so refreshing a hash
 * URL always reloads `/` and works — but a CLEAN path only survives a refresh
 * if the server has a route for it. Without this file `/billing` (and the paths
 * a user actually types or shares) answered with a 404 page on refresh.
 * `public/app.js` maps this path to the `projects` screen; the shell is identical
 * to `/` and `/workspace`, and no data is server-rendered: every panel is
 * filled from the real authenticated APIs after the shell boots, so the same
 * authorization rules apply whether the screen was reached by click or by
 * direct navigation.
 */
export default function Page() {
  return <Home />;
}
