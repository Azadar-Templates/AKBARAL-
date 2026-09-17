import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';
import { FeedbackForm } from '../../_components/feedback-form';

export const metadata: Metadata = {
  title: 'Feedback — AKBARAL!',
  description: 'Submit product feedback, bug reports, feature requests and abuse reports to AKBARAL! — tracked against your account with visible review status.',
};

export default function FeedbackPage() {
  return (
    <SitePage currentPath="/feedback">
      <section className="pk-hero">
        <span className="pk-kicker">Feedback</span>
        <h1>Help us build it better</h1>
        <p>
          Bug reports, feature requests and honest feedback — submitted through the real
          feedback system, tied to your account, with visible review status. Not a
          suggestion box that goes nowhere.
        </p>
      </section>
      <div className="pk-page">
        <FeedbackForm />
      </div>
    </SitePage>
  );
}
