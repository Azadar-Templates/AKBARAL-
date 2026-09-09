import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'AKBARAL! — One AI system. Thousands of specialists.',
  description: 'AKBARAL! / MASTER AI turns a goal into coordinated AI execution: planning, specialist agents, real tools, verification and honest credits.',
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
    <html lang="en" data-theme="light">
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f3f5fb" />
        <link rel="stylesheet" href="/styles.css?v=page-tsx-premium-v5" />
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
        <script src="/app.js?v=page-tsx-premium-v7" />
      </body>
    </html>
  );
}
