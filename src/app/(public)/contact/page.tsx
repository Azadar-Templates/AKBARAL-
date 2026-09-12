import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';
import { ContactForm } from '../../_components/contact-form';

export const metadata: Metadata = {
  title: 'Contact — AKBARAL!',
  description: 'Get in touch with the AKBARAL! team: questions, partnership, security reports and support requests — every submission is stored and reviewed.',
};

export default function ContactPage() {
  return (
    <SitePage currentPath="/contact">
      <section className="pk-hero">
        <span className="pk-kicker">Contact</span>
        <h1>Talk to the team</h1>
        <p>
          Questions about the platform, partnership ideas, or a security report — send it here.
          Submissions are stored in our review queue and answered from the email you provide.
        </p>
      </section>
      <div className="pk-page">
        <div className="ctc-cols">
          <ContactForm />
          <aside className="ctc-aside">
            <h3>Direct channels</h3>
            <p><strong>In-product feedback:</strong> signed-in users can submit categorized feedback with status tracking — <a href="/feedback">Feedback page</a>.</p>
            <p><strong>Security:</strong> mark your subject “security”. Reports are triaged against the <a href="/security">documented controls</a>.</p>
            <p><strong>Support:</strong> registered accounts get priority through the in-app channel.</p>
            <h3>Response times</h3>
            <p>Small team, honest expectations: most messages get a first reply within two business days.</p>
          </aside>
        </div>
      </div>
    </SitePage>
  );
}
