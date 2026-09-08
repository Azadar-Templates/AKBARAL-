import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'AKBARAL! — One AI system. Thousands of specialists.',
  description: 'AKBARAL! / MASTER AI turns a goal into coordinated AI execution: planning, specialist agents, real tools, verification and honest credits.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f3f5fb" />
        <link rel="stylesheet" href="/styles.css?v=page-tsx-premium-v3" />
      </head>
      <body>
        {children}
        <script src="/app.js?v=page-tsx-premium-v3" />
      </body>
    </html>
  );
}
