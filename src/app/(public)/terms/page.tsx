import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Terms of Service — AKBARAL!',
  description: 'The terms that govern your use of the AKBARAL! platform, credits and agent services.',
};

export default function TermsPage() {
  return (
    <SitePage currentPath="/terms">
      <section className="pk-hero">
        <span className="pk-kicker">Legal</span>
        <h1>Terms of Service</h1>
        <p>Plain-language, implementation-accurate. Last updated: 18 September 2026.</p>
      </section>
      <div className="pk-page">
        <div className="pk-prose">
          <h2>1. Agreement</h2>
          <p>By creating an AKBARAL! account or using the platform you agree to these
            terms. If you use the platform on behalf of an organization, you confirm you
            are authorized to bind it.</p>

          <h2>2. The service</h2>
          <p>AKBARAL! executes tasks using AI planning, specialist agents and integrated
            tools, and returns results with verification status. The platform shows real
            availability: features that depend on external providers operate only when
            those providers are configured.</p>

          <h2>3. Your account</h2>
          <ul>
            <li>You are responsible for the accuracy of your account data and for keeping
              your credentials secure.</li>
            <li>One person or organization per account; workspace seats are governed by
              your plan.</li>
            <li>You must be of legal age to form a binding contract.</li>
          </ul>

          <h2>4. Acceptable use</h2>
          <ul>
            <li>Do not use the platform for unlawful purposes, or to generate content that
              infringes rights, harasses, defrauds or endangers people.</li>
            <li>Do not attempt to bypass rate limits, access other users&apos; data,
              reverse-engineer security controls, or overload the service.</li>
            <li>Do not submit malware or malicious files.</li>
            <li>Informational outputs (legal, financial, medical and similar) are research
              assistance, not professional advice.</li>
          </ul>

          <h2>5. Credits and payment</h2>
          <ul>
            <li>Task credits are consumed <strong>only when a task completes
              successfully</strong>; failed tasks restore the credit.</li>
            <li>Plans and one-off credit purchases are billed as displayed on the
              <a href="/pricing"> Pricing page</a>. Where card checkout is not yet enabled,
              purchases are completed through a manual review flow and nothing is charged
              silently.</li>
            <li>Credits are a license to use the service; they are not property, do not
              expire during an active subscription, and have no cash value.</li>
          </ul>

          <h2>6. Your content and agents</h2>
          <p>You retain ownership of the goals, files and data you submit, and of agents
            you create in the Agent Factory. You grant the platform the limited right to
            process that content solely to execute your tasks. Agents you publish to the
            marketplace are licensed to other users for execution on the platform.</p>

          <h2>7. AI output</h2>
          <p>AI-generated results may be incomplete or inaccurate despite verification.
            You are responsible for reviewing outputs before relying on them, particularly
            for professional or high-stakes decisions.</p>

          <h2>8. Availability</h2>
          <p>We work to keep the platform available, including durable task queues,
            recovery procedures and verified backups, but we do not guarantee uninterrupted
            service. Planned maintenance is communicated where practical.</p>

          <h2>9. Liability</h2>
          <p>To the maximum extent permitted by law, the platform is provided &quot;as
            is&quot; and our aggregate liability is limited to the amount you paid in the
            twelve months before the claim. We are not liable for indirect or
            consequential damages.</p>

          <h2>10. Termination</h2>
          <p>You may delete your account at any time. We may suspend accounts that violate
            these terms, with notice where practical.</p>

          <h2>11. Changes</h2>
          <p>Material changes to these terms will be announced in the platform before
            taking effect. Continued use after the effective date constitutes acceptance.</p>
        </div>
      </div>
    </SitePage>
  );
}
