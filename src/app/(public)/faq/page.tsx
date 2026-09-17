import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'FAQ — AKBARAL!',
  description: 'Frequently asked questions about AKBARAL!: what it is, how credits work, the 4,001 agents, the Agent Factory, providers, privacy and support.',
};

const FAQ = [
  {
    q: 'What is AKBARAL!?',
    a: 'A universal AI operating platform. You state a natural-language goal; the system understands it, plans the work, selects specialist agents, executes with real tools, verifies the result, and delivers it with the full execution record. Tagline: One Intelligence. Every Solution.',
  },
  {
    q: 'What kinds of tasks can I ask for?',
    a: 'Any internet-solvable task: research, coding, business analysis, documents, data, marketing, SEO, ecommerce, finance/legal/health information, travel, jobs, translation, automation, email drafts and more. Custom needs can be met by defining an agent in the Agent Factory. Informational outputs (legal, financial, medical) are research assistance, not professional advice.',
  },
  {
    q: 'How do credits work?',
    a: 'One credit = one successfully completed task. Credits are consumed only after verification passes. Failed tasks restore the credit automatically. If a task needs a resource outside your plan, you are told before anything is spent.',
  },
  {
    q: 'Is there a free tier?',
    a: 'Yes: a 30-day free trial with 5 tasks, no card required. Paid plans start at $10/month — see Pricing for the full ladder.',
  },
  {
    q: 'Are the 4,001 agents real?',
    a: 'Yes. Every agent is a structured registry definition with capabilities, inputs, outputs, tool permissions, a workflow and verification rules. You can inspect any of them in Agent World before running — nothing is a mock card.',
  },
  {
    q: 'Can I create my own agents?',
    a: 'Yes — the Agent Factory gives you the same contract shape the registry uses, plus real testing, versioning and a governed publish lifecycle (DRAFT → TESTING → APPROVED → ACTIVE). Publishing to the marketplace is a separate, deliberate step.',
  },
  {
    q: 'Which AI models does AKBARAL! use?',
    a: 'A multi-provider router spans OpenAI, Anthropic and Google models and picks per task. Availability is honest: a provider appears as available only when it is actually configured on the platform.',
  },
  {
    q: 'What happens if a task fails or the platform restarts?',
    a: 'Failed tasks show the reason and restore your credit; you can retry. The execution queue is durable, with crash recovery and reconciliation built in — mid-flight work is picked back up, not lost.',
  },
  {
    q: 'Who owns my data and agents?',
    a: 'You do. You retain ownership of goals, files and factory agents; the platform processes them only to execute your tasks. You can delete tasks, projects and your account at any time.',
  },
  {
    q: 'Is there a mobile app?',
    a: 'A mobile companion app (Expo/React Native, Android-first) mirrors the core workflow: dashboard, MASTER, tasks, agents and billing. The web app is fully responsive and remains the primary surface.',
  },
  {
    q: 'How do I report a bug or security issue?',
    a: 'Through the in-app Feedback form (there is a security category) or the contact page. Security reports are triaged against the platform\'s documented controls; see the Security page.',
  },
];

export default function FaqPage() {
  return (
    <SitePage currentPath="/faq">
      <section className="pk-hero">
        <span className="pk-kicker">FAQ</span>
        <h1>Frequently asked questions</h1>
        <p>Short, accurate answers — matching the implementation, not marketing.</p>
      </section>
      <div className="pk-page">
        <div className="faq-list">
          {FAQ.map((item, i) => (
            <details key={i} className="faq-item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </SitePage>
  );
}
