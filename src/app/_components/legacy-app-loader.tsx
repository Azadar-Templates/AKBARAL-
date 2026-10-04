'use client';

import { useEffect } from 'react';

const RETIRED_ASSET_REFERENCES = [
  '/assets/app.js?v=akbaral-ui-reset-1',
  '/assets/styles.css?v=akbaral-ui-reset-1',
  '/assets/tokens.css?v=akbaral-ui-reset-1',
];

/**
 * Legacy loader retained for the archived hash client asset.
 *
 * The October UI reset moves the public landing, auth screens, and workspace
 * pages to typed App Router surfaces. The legacy bundle remains available under
 * /assets/app.js for historical audits, but it is not mounted over the new UI;
 * mounting it was the source of root-to-auth redirects and mixed old/new chrome.
 */
export function LegacyAppLoader() {
  useEffect(() => {
    document.getElementById('boot-veil')?.remove();
    document.getElementById('ak-fonts')?.setAttribute('media', 'all');
    void RETIRED_ASSET_REFERENCES;
  }, []);

  return null;
}
