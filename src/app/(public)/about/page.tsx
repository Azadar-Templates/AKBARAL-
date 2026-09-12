import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'About — AKBARAL!',
  description:
    'AKBARAL! is a universal AI operating platform: one intelligence coordinating 4,001 real specialist agents, with honest execution, verification and credits. Built as one coherent system, not a wrapper.',
};

export default function AboutPage() {
  return (
    <SitePage currentPath="/about">
      <section className="pk-hero">
        <span className="pk-kicker">About</span>
        <h1>One Intelligence. Every Solution.</h1>
        <p>
          AKBARAL! exists because single-chat AI answers questions, but people and
          businesses need completed work — researched, cross-checked, assembled and
          verifiable. We built the platform we wanted to use.
        </p>
      </section>

      <div className="pk-page">
        <div className="pk-prose">
          <section className="pk-section" aria-labelledby="what-h">
            <h2 id="what-h">What AKBARAL! is</h2>
            <p>
              AKBARAL! is a <strong>universal AI operating platform</strong>. You state a
              goal in natural language; the platform understands the goal, plans the work,
              selects specialists from a registry of <strong>4,001 real agent
              definitions</strong>, executes with actual tools, verifies the output, and
              hands you the result together with the full execution record.
            </p>
            <p>
              It is not a chat wrapper. The orchestration engine — goal analyzer, planner,
              router, executor, verifier and synthesizer — is purpose-built, and every
              agent in the registry is a structured definition with capabilities,
              workflows, tool requirements and verification rules. The same engine powers
              the workspace, the Agent Factory, automations, the marketplace and the CRM.
            </p>
          </section>

          <section className="pk-section" aria-labelledby="principles-h">
            <h2 id="principles-h">How we build</h2>
            <ul>
              <li><strong>No fake work.</strong> Agents, progress and results are real. If something is not configured or cannot run, the platform says so.</li>
              <li><strong>Verified completion.</strong> Tasks pass a verification stage before they count. A free task is consumed only on success — failures restore the credit.</li>
              <li><strong>Inspectability.</strong> Plans, selected agents, tool activity and verification status are visible in real time, not summarized away.</li>
              <li><strong>One identity.</strong> The same design system and execution rules run on web and mobile.</li>
              <li><strong>Engineering honesty.</strong> What is documented on this site reflects what is implemented — including the boundaries.</li>
            </ul>
          </section>

          <section className="pk-section" aria-labelledby="built-h">
            <h2 id="built-h">How it is built</h2>
            <p>
              A single TypeScript codebase: a Next.js front end, an Express API, a durable
              execution queue, a multi-provider model router (OpenAI, Anthropic, Google),
              and a dual-engine data layer that runs SQLite for local development and
              PostgreSQL in production. The production stack is deployed as one
              reproducible container image with automated, content-verified publishing —
              the same image that runs in testing is the one that runs in production.
            </p>
          </section>
        </div>
      </div>
    </SitePage>
  );
}
