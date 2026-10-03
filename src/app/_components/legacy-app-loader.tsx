'use client';

import { useEffect } from 'react';

const SCRIPT_ID = 'akbaral-legacy-app';
const SCRIPT_SOURCE = '/assets/app.js?v=akbaral-lux-18';

function isTypedExperience() {
  return window.location.pathname === '/workspace' || window.location.pathname === '/master';
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
