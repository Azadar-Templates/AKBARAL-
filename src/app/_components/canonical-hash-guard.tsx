'use client';

import { useEffect } from 'react';

/**
 * Hash bookmarks predate the App Router. Redirect them before the legacy
 * bundle can select an old dashboard, agent, billing, or MASTER screen.
 * Authentication hashes remain owned by the unchanged auth host.
 */
export function CanonicalHashGuard() {
  useEffect(() => {
    const canonicalize = () => {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0].toLowerCase();
      if (!hash || hash === 'login' || hash === 'register' || hash === 'oauth/callback') return;
      const work = new Set(['master', 'workspace', 'tasks']);
      const publicLanding = new Set(['landing', 'agents', 'agent-factory', 'factory', 'features', 'about', 'contact', 'documentation', 'faq', 'help', 'feedback', 'pricing', 'privacy', 'security', 'terms']);
      const target = work.has(hash) ? '/work' : publicLanding.has(hash) ? '/' : '/chat';
      window.location.replace(target);
    };
    canonicalize();
    window.addEventListener('hashchange', canonicalize);
    return () => window.removeEventListener('hashchange', canonicalize);
  }, []);
  return null;
}
