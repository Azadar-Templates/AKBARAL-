import Link from 'next/link';
import { AKBARAL_PLANS, PRICING_NOTE } from '../_lib/pricing';
import { lemonCheckoutUrl } from '../_lib/lemon-config';
import styles from './public-pricing.module.css';

/**
 * The single public pricing table, shared by the landing #pricing section and
 * the /pricing route. Paid plan CTAs open the owner-configured Lemon Squeezy
 * checkout (same config for both surfaces via ../_lib/lemon-config). A paid
 * plan without a mapped variant shows an honest "Not yet available" state —
 * never a dead or placeholder link. Free keeps the existing in-app trial.
 *
 * `checkoutUrl` is injectable for tests; production always uses the real
 * lemonCheckoutUrl default.
 */
export function PublicPricingTable({
  ctaHref = '/signup',
  ctaLabel = 'Start Free Trial',
  checkoutUrl = lemonCheckoutUrl,
}: {
  ctaHref?: string;
  ctaLabel?: string;
  checkoutUrl?: (planKey: string) => string | null;
}) {
  return <div className={styles.table} data-pricing-table="akbaral-six-plans">
    {AKBARAL_PLANS.map((plan) => {
      const checkout = plan.key === 'free' ? null : checkoutUrl(plan.key);
      return <article className={styles.plan} key={plan.key} data-plan={plan.key}>
        <div><span className={styles.planName}>{plan.name}</span><strong>{plan.price}</strong><span className={styles.currency}>USD</span></div>
        <p>{plan.tasks}</p>
        <small>{plan.note}</small>
        {plan.key === 'free'
          ? <Link className={styles.cta} href={ctaHref}>{ctaLabel}</Link>
          : checkout
            ? <Link className={styles.cta} data-lemon-checkout={plan.key} href={checkout} target="_blank" rel="noopener noreferrer">Checkout ↗</Link>
            : <button type="button" className={`${styles.cta} ${styles.ctaUnavailable}`} data-lemon-unavailable={plan.key} aria-disabled="true" disabled>Not yet available</button>}
      </article>;
    })}
    <p className={styles.note}>{PRICING_NOTE}</p>
  </div>;
}

export function PublicPricingFaq() {
  return <section className={styles.faq} aria-labelledby="pricing-faq-title"><div><span className={styles.eyebrow}>Pricing FAQ</span><h2 id="pricing-faq-title">Plain answers before you choose.</h2></div><div className={styles.faqList}>
    <details><summary>Is the Free plan a trial?</summary><p>Free is $0 and includes 5 tasks during a 30-day trial. The account shows the actual state returned by the billing system.</p></details>
    <details><summary>What does a task credit cover?</summary><p>Credits apply to Work tasks. Chat is a separate conversation surface. Work credits are consumed on successful completion; the existing backend refund path handles supported failures.</p></details>
    <details><summary>Can I cancel or request a refund?</summary><p>Cancel through the account billing controls when available. Refund eligibility follows the actual billing record and applicable policy; this page does not promise an automatic refund outside the existing backend behavior.</p></details>
  </div></section>;
}
