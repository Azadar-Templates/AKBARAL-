import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Security — AKBARAL!',
  description:
    'AKBARAL! security architecture: encrypted sessions with rotating refresh tokens, RBAC, rate limiting, SSRF protection, upload validation, audit logging and secret handling — the real controls, documented.',
};

const CONTROLS = [
  { title: 'Authentication', items: [
    'Email/password accounts with industry-standard password hashing and strength policy',
    'Short-lived JWT access tokens plus rotating refresh tokens with revocation on logout',
    'Email verification and password reset flows with single-use, expiring tokens',
    'OAuth sign-in (Google, GitHub, Microsoft, Apple) — providers appear only when actually configured',
  ]},
  { title: 'Authorization & isolation', items: [
    'Role-based access control (user / admin) enforced at the route layer',
    'Every task, project, file and agent access checks ownership before returning data',
    'Workspace membership gates project-scoped data; admin surfaces require the admin role',
  ]},
  { title: 'API hardening', items: [
    'Rate limiting: 300 requests/minute per client across the API, 30/minute on authentication endpoints',
    'Strict input validation on every request body; malformed input is rejected before business logic',
    'Security headers on all responses; CORS restricted to an explicit origin allowlist',
    'Webhook endpoints verify provider signatures before processing billing events',
  ]},
  { title: 'File & network safety', items: [
    'Upload validation with size limits and content checks',
    'SSRF protection on all outbound fetching performed by research agents (private addresses blocked)',
    'Parameterized queries everywhere — the typed data layer makes SQL injection structurally difficult',
  ]},
  { title: 'Secrets & keys', items: [
    'Provider API keys live only in server-side environment configuration — never in the browser, never in logs',
    'Secrets are redacted in logs; database credentials are masked in all operational output',
    'Production runs behind TLS with encrypted PostgreSQL connections (sslmode required)',
  ]},
  { title: 'Accountability', items: [
    'Audit logging of security-relevant actions',
    'Durable execution queue with crash recovery and reconciliation — no silently lost tasks',
    'Verified database backups with tested restore procedures',
  ]},
];

export default function SecurityPage() {
  return (
    <SitePage currentPath="/security">
      <section className="pk-hero">
        <span className="pk-kicker">Security</span>
        <h1>Security you can inspect</h1>
        <p>
          This page documents the controls actually implemented in AKBARAL! —
          the same controls covered by the platform&apos;s automated security tests.
          Nothing here is aspirational.
        </p>
      </section>

      <div className="pk-page">
        <section className="pk-section" aria-label="Security controls">
          <div className="pk-grid pk-grid-2">
            {CONTROLS.map((group) => (
              <article key={group.title} className="pk-card">
                <h3>{group.title}</h3>
                <p style={{ display: 'grid', gap: 10 }}>
                  {group.items.map((item) => <span key={item}>— {item}</span>)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="pk-section pk-prose" aria-labelledby="data-h">
          <h2 id="data-h">Your data</h2>
          <p>
            Task content, files and execution records belong to the account that created
            them and are never exposed across accounts. Data is stored in a managed
            PostgreSQL database with encrypted connections; nightly verified backups are
            taken and retention is bounded. See the <a href="/privacy">Privacy Policy</a> for
            how personal data is handled and removed.
          </p>
          <h2>Reporting a vulnerability</h2>
          <p>
            If you find a security issue, contact us through the in-app feedback form
            (choose the security category) with reproduction details. We will
            investigate and fix confirmed issues.
          </p>
        </section>
      </div>
    </SitePage>
  );
}
