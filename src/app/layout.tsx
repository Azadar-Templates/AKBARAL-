import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const metadata: Metadata = {
  title: 'AKBARAL! — One Intelligence. Every Solution.',
  description: 'AKBARAL! / MASTER AI turns a goal into coordinated AI execution: planning, specialist agents, real tools, verification and honest credits. 4,000+ specialists across 80 disciplines.',
};

/**
 * Hero background-video slot (see docs/DESIGN.md):
 * when public/media/hero-loop.mp4 exists, the server exposes a flag so the
 * client plays it directly — no network probing (a HEAD 404 on every visit
 * would log console errors). Without the file the client runs the original
 * canvas intelligence-network animation. Adding/removing the video requires
 * a dev restart / production rebuild for this flag to update.
 */
const heroVideoPath = path.join(process.cwd(), 'public', 'media', 'hero-loop.mp4');
const heroVideoEnabled = existsSync(heroVideoPath);

/**
 * Google AdSense publisher id (e.g. "ca-pub-1234567890123456").
 *
 * HONEST AD ARCHITECTURE (launch readiness):
 * - When AKBARAL_ADSENSE_CLIENT is NOT set (the current launch default), the
 *   web app exposes NO ad client id, loads NO ad script, renders NO ad slots
 *   and serves NO ads.txt. Nothing pretends to be monetized.
 * - When an operator sets a real publisher id, only the id is exposed here;
 *   the client (public/app.js) still loads the AdSense script only after the
 *   visitor accepts the advertising-consent banner, and slots are clearly
 *   labelled "Advertisement" in non-intrusive positions.
 */
const adsenseClient = (process.env.AKBARAL_ADSENSE_CLIENT ?? '').trim();

/**
 * Pre-paint theme restore. The SPA bootstrap (public/app.js) intentionally
 * waits until AFTER React hydration to touch the DOM (prevents hydration
 * mismatches), so without this snippet light-theme users would see a dark
 * flash first. This inline snippet only touches <html data-theme>, which
 * carries suppressHydrationWarning — the officially sanctioned pattern for
 * exactly this (see next-themes).
 */
const themeSnippet = `try{var t=localStorage.getItem('ak_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the theme attribute may be set pre-hydration
    // by the snippet above (or post-hydration by the SPA) — React must not
    // treat that as a mismatch.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#050604" />
        <script dangerouslySetInnerHTML={{ __html: themeSnippet }} />
        {heroVideoEnabled ? (
          <script dangerouslySetInnerHTML={{ __html: 'window.__AKBARAL_HERO_VIDEO__=true;' }} />
        ) : null}
        {/* Premium editorial type: Space Grotesk (display) + Inter (text),
            swapped with system fallbacks — never a render blocker. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
        <link rel="stylesheet" href="/styles.css?v=cinematic-v3" />
        {adsenseClient ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__AKBARAL_ADSENSE_CLIENT__=${JSON.stringify(adsenseClient)};`,
            }}
          />
        ) : null}
      </head>
      <body>
        {children}
        <script src="/app.js?v=cinematic-v3" />
      </body>
    </html>
  );
}
