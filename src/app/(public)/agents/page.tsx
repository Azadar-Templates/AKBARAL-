import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';
import { AgentsExplorer } from '../../_components/agents-explorer';

export const metadata: Metadata = {
  title: 'Agent World — 4,001 Specialists — AKBARAL!',
  description:
    'Browse the real AKBARAL! agent registry: 4,001 specialist definitions across every discipline — search, filter by category, inspect capabilities, workflows and tools, then run them with real execution.',
};

export default function AgentsPage() {
  return (
    <SitePage currentPath="/agents">
      <section className="pk-hero">
        <span className="pk-kicker">Agent World</span>
        <h1>4,001 genuine specialists</h1>
        <p>
          Every agent below is a real registry definition — with capabilities, inputs,
          outputs, tool permissions, workflow and verification rules. Search the catalog,
          open any agent to inspect its contract, then run it inside the platform.
        </p>
      </section>
      <AgentsExplorer />
    </SitePage>
  );
}
