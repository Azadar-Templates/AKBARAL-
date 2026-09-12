import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Agent Factory — AKBARAL!',
  description:
    'Build your own agents on the AKBARAL! execution engine: purpose, instructions, capabilities, tools, workflow and verification rules — with testing, versioning and a governed publish lifecycle.',
};

const LIFECYCLE = [
  { stage: 'DRAFT', text: 'Define the agent: purpose, instructions, capabilities, tools, workflow and verification rules.' },
  { stage: 'TESTING', text: 'Run it against real test goals. The engine records outcomes — nothing is published untested.' },
  { stage: 'FAILED', text: 'If tests fail, the agent lands here with the failure reasons attached. No silent pass-through.' },
  { stage: 'FIXING', text: 'Revise the definition. Every change is a new version — history is preserved, not overwritten.' },
  { stage: 'RETESTING', text: 'Re-run the test suite against the fixed version. The gate is real, not ceremonial.' },
  { stage: 'APPROVED', text: 'A verified agent ready to publish. Approval reflects passing tests, not a checkbox.' },
  { stage: 'ACTIVE', text: 'Live in your workspace and — if you choose — the marketplace, executing under your usage controls.' },
  { stage: 'DISABLED', text: 'Retired on your terms. Disabled agents stop executing but their history remains auditable.' },
];

const BLOCKS = [
  { title: 'Structured definition', text: 'Agents are defined through a structured form, not a prompt box: purpose, system instructions, capabilities, tool permissions, workflow steps and verification rules — the same contract shape the 4,001 registry agents use.' },
  { title: 'Real testing', text: 'The factory runs your agent against test goals and records genuine outcomes. The lifecycle state machine (DRAFT → TESTING → … → ACTIVE) is enforced by the engine.' },
  { title: 'Versioning', text: 'Every saved change creates a version. You can trace what changed, when, and re-run previous versions during development.' },
  { title: 'Usage controls', text: 'Your agents run under the platform\'s credit and permission rules — including honest capability limits. If an agent needs a provider that is not configured, it says so.' },
  { title: 'Publishing', text: 'Publishing to the marketplace is a deliberate step with review — not an automatic side effect. Unpublished agents stay private to your account.' },
  { title: 'Permissions', text: 'Tool access is explicit: an agent gets only the tools you grant. The registry\'s tool-permission model applies to factory agents identically.' },
];

export default function AgentFactoryPage() {
  return (
    <SitePage currentPath="/agent-factory">
      <section className="pk-hero">
        <span className="pk-kicker">Agent Factory</span>
        <h1>Build agents, not prompts</h1>
        <p>
          The Agent Factory turns your expertise into reusable specialists on the same
          execution engine that powers the registry — defined properly, tested for real,
          versioned, and published under governance.
        </p>
      </section>

      <div className="pk-page">
        <section className="pk-section" aria-labelledby="lifecycle-h">
          <h2 id="lifecycle-h">The real lifecycle</h2>
          <p className="pk-lede">
            Every factory agent moves through this exact state machine — enforced by the
            engine, visible in the UI at every step.
          </p>
          <ol className="afc-cycle">
            {LIFECYCLE.map((s, i) => (
              <li key={s.stage} className="afc-cycle-step">
                <span className="afc-stage">{s.stage}</span>
                <span className="afc-step-text">{s.text}</span>
                {i < LIFECYCLE.length - 1 && <span className="afc-arrow" aria-hidden="true">→</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className="pk-section" aria-labelledby="blocks-h">
          <h2 id="blocks-h">What you control</h2>
          <div className="pk-grid pk-grid-3">
            {BLOCKS.map((b) => (
              <article key={b.title} className="pk-card">
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pk-section pk-prose">
          <h2>Start building</h2>
          <p>
            The Factory is part of the workspace: create an account, open the Factory tab,
            and define your first specialist. Free accounts can build and test agents;
            publishing and higher agent counts follow your plan
            (see <a href="/pricing">pricing</a>).
          </p>
          <p><a className="pk-btn pk-btn-primary" href="/#/register">Create an account</a></p>
        </section>
      </div>
    </SitePage>
  );
}
