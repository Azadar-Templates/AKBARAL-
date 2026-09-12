import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Documentation — AKBARAL!',
  description:
    'AKBARAL! documentation: core concepts (goals, tasks, agents, verification, credits), the workspace, the public catalog API, and the platform architecture — as implemented.',
};

const API_GROUPS = [
  { group: 'Authentication', endpoints: 'POST /api/auth/register · login · logout · refresh · password reset · email verification' },
  { group: 'OAuth', endpoints: 'GET /api/auth/oauth/:provider/authorize · callback · POST link — google, github, microsoft, apple (visible only when configured)' },
  { group: 'MASTER orchestration', endpoints: 'POST /api/master (goal → workflow) · GET /api/master/:id (plan, steps, agents, status)' },
  { group: 'Tasks', endpoints: 'GET /api/tasks · /api/tasks/:id · POST /api/tasks/:id/cancel · /api/tasks/research · task files' },
  { group: 'Agents (account)', endpoints: 'GET /api/agents · /:slug · /categories · POST /:slug/save' },
  { group: 'Public catalog', endpoints: 'GET /api/public/agents?q&category&limit&offset · /api/public/agents/:slug · /api/public/agent-categories — read-only, platform agents only' },
  { group: 'Agent Factory', endpoints: 'CRUD + lifecycle transitions + test runs + versions under /api/factory' },
  { group: 'Marketplace & Agent World', endpoints: 'listings, install, reviews, favorites under /api/marketplace and /api/world' },
  { group: 'Billing', endpoints: 'GET /api/billing/plans · /account · /usage · POST /switch · webhook (signature-verified)' },
  { group: 'Projects · Automations · CRM', endpoints: 'CRUD under /api/projects, /api/automations, /api/crm (ownership enforced)' },
  { group: 'Feedback & trust', endpoints: 'POST /api/feedback · GET /api/feedback/mine · task ratings · admin feedback review' },
  { group: 'Platform', endpoints: 'GET /api/health (status + database check) · /api/models (honest provider availability) · /api/notifications · realtime execution stream' },
];

export default function DocumentationPage() {
  return (
    <SitePage currentPath="/documentation">
      <section className="pk-hero">
        <span className="pk-kicker">Documentation</span>
        <h1>The platform, documented as built</h1>
        <p>
          Core concepts, the workspace, and the real API surface. This documents the
          implementation you are using — including its honest limits.
        </p>
      </section>
      <div className="pk-page">
        <div className="pk-prose">
          <h2>Core concepts</h2>
          <h3>Goal</h3>
          <p>A plain-language description of the outcome you want, optionally with attached files. Everything starts here.</p>
          <h3>Workflow</h3>
          <p>The plan the engine produces: ordered steps, dependencies, and the specialists selected for each. Stored, versioned and inspectable per task.</p>
          <h3>Agent</h3>
          <p>A structured specialist definition: capabilities, inputs/outputs, tool permissions, workflow and verification rules. 4,001 registry agents ship with the platform; you can build your own in the Factory.</p>
          <h3>Verification</h3>
          <p>The post-execution stage that checks results against the plan. Completion — and credit consumption — happen only after verification.</p>
          <h3>Credits</h3>
          <p>Success-based units of work. Consume on verified completion; restore on failure. Managed per account with an idempotent transaction engine.</p>

          <h2>The workspace</h2>
          <p>
            After signing in you get: a dashboard (recent tasks, usage, credits), the MASTER
            goal console, task history with full execution detail, projects, automations,
            Agent World, the Factory, marketplace, CRM, billing and settings. Every list is
            owned — data is never shared across accounts.
          </p>

          <h2>Public catalog API</h2>
          <p>The public agent directory is backed by a read-only, unauthenticated API:</p>
          <ul>
            <li><code>GET /api/public/agents?q=&category=&limit=&offset=</code> — paginated platform agents (max 60/page)</li>
            <li><code>GET /api/public/agents/:slug</code> — one agent&apos;s public contract</li>
            <li><code>GET /api/public/agent-categories</code> — categories with live counts</li>
            <li><code>GET /api/public/registry-stats</code> — registry size</li>
          </ul>
          <p>Everything else requires authentication. Standard rate limit: 300 requests/minute per client; 30/minute on auth endpoints.</p>

          <h2>API surface overview</h2>
          <div className="doc-api">
            {API_GROUPS.map((g) => (
              <div key={g.group} className="doc-api-row">
                <strong>{g.group}</strong>
                <span>{g.endpoints}</span>
              </div>
            ))}
          </div>
          <div className="pk-note">
            Provider configuration note: model providers (OpenAI, Anthropic, Google) are
            server-side configuration. <code>/api/models</code> reports honest availability —
            when a provider is not configured, tasks that require it say so instead of failing
            silently or pretending to succeed.
          </div>
        </div>
      </div>
    </SitePage>
  );
}
