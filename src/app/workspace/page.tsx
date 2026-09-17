import type { Metadata } from 'next';
import Home from '../page';

export const metadata: Metadata = {
  title: 'Workspace — AKBARAL!',
  description:
    'The AKBARAL! workspace: one screen with your MASTER conversation, the live preview canvas and every file and artifact your account owns.',
  // A signed-in application surface: reachable, never a marketing page.
  robots: { index: false, follow: false },
};

/**
 * /workspace — the AKBARAL! application shell.
 *
 * A real route (not only the `#/master` hash screen) so the workspace can be
 * bookmarked, shared inside an account and used as the post-sign-in home.
 * It renders the same single-page application as `/`; public/app.js detects
 * this path and opens the MASTER screen directly instead of the landing page.
 * No data is rendered server-side: every panel is filled from the real
 * authenticated APIs after the shell boots.
 */
export default function WorkspacePage() {
  return <Home />;
}
