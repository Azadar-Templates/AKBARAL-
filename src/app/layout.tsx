import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const metadata: Metadata = {
  title: 'AKBARAL! — One Intelligence. Every Solution.',
  description: 'AKBARAL! / MASTER AI turns a goal into coordinated AI execution: planning, specialist agents, real tools, verification and honest credits. 4,000+ specialists across 80 disciplines.',
};

/**
 * Hero background-video slot (see docs/DESIGN.md):
 * when public/media/hero-loop.mp4 exists, the server exposes a META FLAG so
 * the client plays it directly — no network probing (a HEAD 404 on every
 * visit would log console errors) and no inline script (React-rendered
 * scripts caused hydration errors). Without the file the client runs the
 * original canvas intelligence-network animation. Adding/removing the video
 * requires a dev restart / production rebuild for this flag to update.
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
 * - When an operator sets a real publisher id, only the id is exposed (as a
 *   meta tag read by the client); the AdSense script still loads only after
 *   the visitor accepts the advertising-consent banner, and slots are
 *   clearly labelled "Advertisement" in non-intrusive positions.
 */
const adsenseClient = (process.env.AKBARAL_ADSENSE_CLIENT ?? '').trim();

/**
 * NO React-rendered scripts and NO pre-hydration DOM mutations — by design.
 *
 * - Server→client configuration travels via <meta> tags (pure data; no
 *   execution, no mutation): `akbaral-hero-video` and
 *   `akbaral-adsense-client` are read by public/app.js.
 * - The theme is NOT restored by an inline pre-paint snippet (that mutated
 *   <html data-theme> before hydration). The server renders the dark
 *   identity by default and public/app.js applies the stored theme from
 *   inside boot(), which runs strictly after hydration.
 * - The SPA bundle loads via next/script `afterInteractive` — Next.js
 *   injects it after hydration, so the raw <script> tag that React had to
 *   hydrate (a hydration-error source) is gone. The bundle additionally
 *   self-gates on the window load event as defense in depth.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#06070f" />
        {heroVideoEnabled ? <meta name="akbaral-hero-video" content="1" /> : null}
        {adsenseClient ? <meta name="akbaral-adsense-client" content={adsenseClient} /> : null}
        {/* Premium editorial type: Space Grotesk (display) + Inter (text),
            swapped with system fallbacks — never a render blocker. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
        <link rel="stylesheet" href="/tokens.css?v=akbaral-lux-2" />
        <link rel="stylesheet" href="/styles.css?v=akbaral-lux-2" />
      </head>
      <body>
        {children}
        <Script src="/app.js?v=akbaral-lux-2" strategy="afterInteractive" />
      </body>
    </html>
  );
}
