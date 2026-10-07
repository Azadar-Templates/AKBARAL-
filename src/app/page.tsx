import type { Metadata } from 'next';
import { heroVideoEnabled } from './_components/atmosphere';
import { LandingReset } from './_components/landing-reset';

export const metadata: Metadata = {
  title: 'AKBARAL! — One Intelligence. Every Solution.',
  description: 'AKBARAL! is one simple workspace for chat, Work tasks, files, projects, agents, billing, settings, and help. The registry contains 4,001 registered agent contracts.',
};

export default function Home() {
  // Read on the server so the flag never has to be inlined into the client
  // bundle. Default is false -> CSS-only atmosphere, no media request.
  return <LandingReset heroVideo={heroVideoEnabled()} />;
}
