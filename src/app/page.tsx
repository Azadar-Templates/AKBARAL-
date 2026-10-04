import type { Metadata } from 'next';
import { LandingReset } from './_components/landing-reset';

export const metadata: Metadata = {
  title: 'AKBARAL! — One Intelligence. Every Solution.',
  description: 'AKBARAL! is one simple workspace for chat, Work tasks, files, projects, agents, billing, settings, and help. The registry contains 4,001 registered agent contracts.',
};

export default function Home() {
  return <LandingReset />;
}
