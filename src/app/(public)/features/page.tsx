import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Platform Features — AKBARAL!',
  description:
    'How AKBARAL! turns a natural-language goal into verified results: goal understanding, planning, master orchestration, 4,001 specialist agents, real tools, verification, credits and automations.',
};

const PIPELINE = [
  { step: '01', name: 'Goal Understanding', detail: 'You state a goal in plain language. The goal analyzer classifies it, extracts constraints and decides what kind of work the goal requires.' },
  { step: '02', name: 'Planning', detail: 'The planner decomposes the goal into an explicit, reviewable workflow — steps, dependencies and expected outputs — before anything executes.' },
  { step: '03', name: 'Agent Selection', detail: 'The router matches steps to specialists from the 4,001-agent registry by capability, tools and model requirements — selection is visible, never a black box.' },
  { step: '04', name: 'Execution', detail: 'Specialist agents execute with real tools — web research, page fetching, file processing. Progress streams live; every step is inspectable.' },
  { step: '05', name: 'Verification', detail: 'The verification engine checks results against the plan before completion. Failures are surfaced honestly with reasons, not hidden.' },
  { step: '06', name: 'Result', detail: 'You receive the final answer plus the full execution record: plan, selected agents, tool activity and verification status. Exportable, replayable.' },
];

const CAPABILITIES = [
  { ico: '◈', title: 'MASTER AI', text: 'The master entry point: one goal in, coordinated multi-agent execution out — with the complete workflow visible at every stage.' },
  { ico: '◇', title: 'Agent World', text: 'A registry of 4,001 genuine specialist agents across 80+ disciplines — research, coding, business, education, documents, data, marketing, SEO, ecommerce, finance, legal, travel and more. Search, filter and run them directly.' },
  { ico: '⬡', title: 'Agent Factory', text: 'Define your own agents through a structured lifecycle: purpose, instructions, capabilities, tools, workflow and verification rules — with testing, versioning and a governed publish path (DRAFT → TESTING → APPROVED → ACTIVE).' },
  { ico: '▦', title: 'Workspace & Projects', text: 'Attach files to goals, save work as projects, inspect task history, retry failures, and export results. Task understanding, planning and execution are shown in real time.' },
  { ico: '⚡', title: 'Automations', text: 'Schedule recurring goals and trigger-driven workflows. The execution queue is durable: crash recovery and reconciliation are built in, not bolted on.' },
  { ico: '◧', title: 'Marketplace & CRM', text: 'Publish agents to the marketplace and run AI employees for CRM workflows — leads, contacts and follow-ups managed by agents under your control.' },
  { ico: '◍', title: 'Honest Credits', text: 'A free task is consumed only after successful completion. If a task cannot be completed, the credit is restored and you are told exactly why. No silent failures, no hidden consumption.' },
  { ico: '◎', title: 'Multi-Provider Models', text: 'The model router spans OpenAI, Anthropic and Google models with per-task routing and honest availability: if a provider is not configured, the platform says so instead of pretending.' },
  { ico: '▢', title: 'Mobile Companion', text: 'An Expo-based mobile app mirrors the core workflow — dashboard, MASTER, tasks, agents and billing — for work away from the desk.' },
];

export default function FeaturesPage() {
  return (
    <SitePage currentPath="/features">
      <section className="pk-hero">
        <span className="pk-kicker">Platform</span>
        <h1>From goal to verified result</h1>
        <p>
          AKBARAL! is a universal AI operating platform. You provide a natural-language goal;
          the system understands, plans, selects specialists, executes with real tools,
          verifies, and delivers — showing you every stage.
        </p>
      </section>

      <div className="pk-page">
        <section className="pk-section" aria-labelledby="pipeline-h">
          <h2 id="pipeline-h">The execution pipeline</h2>
          <p className="pk-lede">
            Every task moves through the same inspectable pipeline. Nothing is faked:
            each stage produces a real artifact you can open.
          </p>
          <div className="pk-grid pk-grid-3">
            {PIPELINE.map((s) => (
              <article key={s.step} className="pk-card">
                <h3><span className="pk-ico" aria-hidden="true">{s.step}</span>{s.name}</h3>
                <p>{s.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pk-section" aria-labelledby="capabilities-h">
          <h2 id="capabilities-h">Platform capabilities</h2>
          <p className="pk-lede">
            Built as one system: the registry, factory, workspace, marketplace and billing
            share the same execution engine and the same honesty rules.
          </p>
          <div className="pk-grid pk-grid-3">
            {CAPABILITIES.map((c) => (
              <article key={c.title} className="pk-card">
                <h3><span className="pk-ico" aria-hidden="true">{c.ico}</span>{c.title}</h3>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pk-section" aria-labelledby="scope-h">
          <h2 id="scope-h">What you can ask for</h2>
          <p className="pk-lede">
            Any internet-solvable task across the registry&apos;s disciplines —
            research reports, code and web development, documents and data analysis,
            marketing and SEO, ecommerce and product listings, finance/legal/health
            information research, travel and maps, job search, translation,
            automation, email drafts, agriculture, gaming, image/video/audio tasks
            where provider tools are configured, and custom work via the Agent Factory.
          </p>
          <div className="pk-note">
            Honest boundary: tasks that require paid provider resources say so before you
            spend a credit. Capabilities that depend on external credentials are shown as
            available only when those credentials are actually configured.
          </div>
        </section>
      </div>
    </SitePage>
  );
}
