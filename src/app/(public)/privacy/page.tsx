import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Privacy Policy — AKBARAL!',
  description: 'How AKBARAL! collects, uses, stores and protects your data, and the choices you have.',
};

export default function PrivacyPage() {
  return (
    <SitePage currentPath="/privacy">
      <section className="pk-hero">
        <span className="pk-kicker">Legal</span>
        <h1>Privacy Policy</h1>
        <p>Plain-language, implementation-accurate. Last updated: 18 September 2026.</p>
      </section>
      <div className="pk-page">
        <div className="pk-prose">
          <h2>1. Who we are</h2>
          <p>AKBARAL! (&quot;we&quot;, &quot;the platform&quot;) operates the AKBARAL! universal AI
            platform at this domain. You can reach us through the in-app feedback form or
            the contact page.</p>

          <h2>2. Data we collect</h2>
          <ul>
            <li><strong>Account data:</strong> the email address you register with, your
              display name, a hashed password (we never store plaintext passwords), and —
              if you use OAuth — the identity your provider confirms.</li>
            <li><strong>Task data:</strong> the goals you submit, files you attach,
              execution records, results and verification outcomes.</li>
            <li><strong>Operational data:</strong> session records, audit log entries
              (security-relevant actions), rate-limiting counters and error telemetry.</li>
            <li><strong>Billing data:</strong> plan selection, credit balance, invoices and
              purchase requests. Card details, when card payments are enabled, are handled
              by the payment provider and never stored on our servers.</li>
          </ul>

          <h2>3. How we use it</h2>
          <ul>
            <li>To operate the platform: authenticate you, run your tasks, maintain your
              projects, credits and history.</li>
            <li>To keep the service safe: abuse prevention, rate limiting, audit logging.</li>
            <li>To communicate: account emails (verification, password reset) and support
              responses.</li>
            <li>We do not sell your personal data.</li>
          </ul>

          <h2>4. AI providers</h2>
          <p>Executing your tasks may require calls to third-party AI providers (for
            example OpenAI, Anthropic or Google). Only the task content needed for
            execution is sent. Provider usage is governed by the respective provider&apos;s
            terms; provider availability is always shown honestly in the platform.</p>

          <h2>5. Storage, retention, security</h2>
          <p>Your data is stored in a managed PostgreSQL database with encrypted
            connections. Access is restricted by role-based controls and ownership checks.
            Security measures include hashed passwords, rotating session tokens, rate
            limiting, upload validation, SSRF protection and audit logging — see the
            <a href="/security"> Security page</a> for the full, current control set.
            Backups are retained for a bounded period; deleting your account removes your
            content from active systems.</p>

          <h2>6. Your choices</h2>
          <ul>
            <li>Access, correct or export your data from your account settings.</li>
            <li>Delete tasks and projects you own at any time.</li>
            <li>Request account deletion via settings or the contact page; associated
              personal data is removed from active systems.</li>
            <li>Use the platform without third-party advertising trackers — we do not run
              ad scripts unless you explicitly consent, and none run by default.</li>
          </ul>

          <h2>7. Children</h2>
          <p>AKBARAL! is not directed at children under 13 (or the equivalent minimum age
            in your jurisdiction), and we do not knowingly collect their data.</p>

          <h2>8. Changes</h2>
          <p>If this policy changes materially, we will notify you in the platform before
            the change takes effect. The date above always reflects the current version.</p>
        </div>
      </div>
    </SitePage>
  );
}
