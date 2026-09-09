import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'AKBARAL! — One Intelligence. Every Solution.',
  description: 'AKBARAL! / MASTER AI turns a goal into coordinated AI execution: planning, specialist agents, real tools, verification and honest credits. 4,000+ specialists across 80 disciplines.',
};

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#050604" />
        {/* Premium editorial type: Space Grotesk (display) + Inter (text),
            swapped with system fallbacks — never a render blocker. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
        <link rel="stylesheet" href="/styles.css?v=cinematic-v1" />
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
        <script src="/app.js?v=cinematic-v1" />
      </body>
    </html>
  );
}
