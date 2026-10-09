import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { existsSync } from 'node:fs';
import { LegacyAppLoader } from './_components/legacy-app-loader';
import path from 'node:path';
import { BRAND_ASSETS } from './_components/brand-mark-data';
import './app-reset.css';
import './glass-material.css';
// Liquid-glass material (presentation only): two depths, a masked gradient
// stroke, and both @supports fallbacks. Loads before every route's CSS module
// so component styles can override it predictably.
import './glass.css';

/**
 * Brand surface of the document head.
 *
 * `metadataBase` is what makes every relative URL below (and every `alternates`
 * canonical Next generates) absolute instead of silently dropping the tag —
 * the same `AKBARAL_SITE_URL` convention robots.ts and sitemap.ts already use,
 * including its default host, so all three agree on the canonical origin.
 *
 * The icon/OG files are repo-served from public/ (see scripts/brand/build.mjs —
 * original geometry, existing tokens.css colours, no CDN, no third-party mark).
 * `theme-color` stays the hand-written tag below; declaring it here too would
 * emit a second, conflicting meta.
 */
const siteBase = process.env.AKBARAL_SITE_URL ?? 'https://akbaral.duckdns.org';

export const metadata: Metadata = {
  metadataBase: new URL(siteBase),
  title: 'AKBARAL! — One Intelligence. Every Solution.',
  description: 'AKBARAL! is one simple workspace for Chat, Task, files, images, projects, agents, automations, dashboard, billing, pricing, settings, and help. The registry contains 4,001 registered agent contracts.',
  applicationName: 'AKBARAL!',
  manifest: BRAND_ASSETS.manifest,
  icons: {
    icon: [
      { url: BRAND_ASSETS.icon, type: 'image/svg+xml' },
      { url: BRAND_ASSETS.favicon32, type: 'image/png', sizes: '32x32' },
      { url: BRAND_ASSETS.favicon16, type: 'image/png', sizes: '16x16' },
      { url: BRAND_ASSETS.favicon, type: 'image/x-icon', sizes: '48x48' },
    ],
    shortcut: [{ url: BRAND_ASSETS.favicon, type: 'image/x-icon' }],
    apple: [{ url: BRAND_ASSETS.appleTouchIcon, type: 'image/png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'AKBARAL!',
    locale: 'en_US',
    images: [
      {
        url: BRAND_ASSETS.ogImage,
        width: 1200,
        height: 630,
        alt: 'AKBARAL! — One Intelligence. Every Solution.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: BRAND_ASSETS.ogImage, width: 1200, height: 630, alt: 'AKBARAL! — One Intelligence. Every Solution.' }],
  },
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
 * - LegacyAppLoader loads the SPA bundle after hydration on application
 *   routes and defers it entirely on the typed marketing experience. A hash
 *   change away from marketing loads it immediately, so public calls to
 *   action still enter the application without carrying unrelated legacy
 *   JavaScript on the landing critical path.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#020617" />
        {heroVideoEnabled ? <meta name="akbaral-hero-video" content="1" /> : null}
        {adsenseClient ? <meta name="akbaral-adsense-client" content={adsenseClient} /> : null}
        {/* Inter carries the product/editorial voice; JetBrains Mono carries
            technical labels. Loading remains off the critical path. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          id="ak-fonts"
          rel="stylesheet"
          media="print"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        {/* Compressed, long-cached text assets (≈3× smaller on the wire) — see
            src/app/assets/[file]/route.ts for why compression lives there and
            not in next.config.mjs (SSE must stay uncompressed). */}
        <link rel="stylesheet" href="/assets/tokens.css?v=akbaral-ui-reset-1" />
      </head>
      <body>
        {children}
        <LegacyAppLoader />
      </body>
    </html>
  );
}
