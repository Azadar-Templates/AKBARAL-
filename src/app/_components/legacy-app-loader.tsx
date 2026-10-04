'use client';

import { useEffect } from 'react';

const SCRIPT_ID = 'akbaral-legacy-app';
const SCRIPT_SOURCE = '/assets/app.js?v=akbaral-lux-18';

function isTypedExperience() {
  // Every clean App Router route owns its UI. The legacy hash application is
  // loaded only by the three routes that intentionally render the legacy Home
  // document (marketing root and password auth). This prevents its broad
  // dashboard navigation from mounting over Chat, Work, account, or owner UI.
  return !['/', '/signin', '/signup'].includes(window.location.pathname);
}

function shouldDeferLegacyApp() {
  return isTypedExperience() || window.location.hash === '#/' || window.location.hash === '#/landing';
}

/**
 * The public landing is a complete React experience and does not need the
 * legacy application bundle. Deferring that bundle removes unrelated app
 * parsing/evaluation from the landing critical path. If a landing action
 * changes the hash, the application bundle is loaded immediately and its
 * router takes over; all non-marketing routes load it on hydration.
 */
export function LegacyAppLoader() {
  useEffect(() => {
    let loaded = false;

    const load = () => {
      if (loaded || document.getElementById(SCRIPT_ID)) return;
      loaded = true;
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SOURCE;
      script.async = true;
      document.body.appendChild(script);
    };

    const loadWhenNeeded = () => {
      if (!shouldDeferLegacyApp()) {
        window.removeEventListener('hashchange', loadWhenNeeded);
        load();
      }
    };

    if (shouldDeferLegacyApp()) document.getElementById('boot-veil')?.remove();
    loadWhenNeeded();
    if (!loaded && !isTypedExperience()) window.addEventListener('hashchange', loadWhenNeeded);
    return () => window.removeEventListener('hashchange', loadWhenNeeded);
  }, []);

  return null;
}
