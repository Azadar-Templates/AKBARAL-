import Link from 'next/link';
import { AKBARAL_PLANS, PRICING_NOTE } from '../_lib/pricing';
import { lemonCheckoutUrl } from '../_lib/lemon-config';
import styles from './public-pricing.module.css';

export interface PublicPricingTableProps {
  ctaHref?: string;
  ctaLabel?: string;
  paidCtaLabel?: string;
  storeUrl?: string;
  variantIds?: Record<string, string | null>;
}

export function PublicPricingTable({
  ctaHref = '/signup',
  ctaLabel = 'Start Free Trial',
  paidCtaLabel = 'Subscribe',
  storeUrl,
  variantIds,
}: PublicPricingTableProps = {}) {
  return (
    <div className={styles.table} data-pricing-table="akbaral-six-plans">
      {AKBARAL_PLANS.map((plan) => {
        const isFree = plan.key === 'free';
        const checkoutUrl = !isFree
          ? lemonCheckoutUrl(plan.key, { storeUrl, variantIds })
          : null;

        return (
          <article className={styles.plan} key={plan.key} data-plan={plan.key}>
            <div>
              <span className={styles.planName}>{plan.name}</span>
              <strong>{plan.price}</strong>
              <span className={styles.currency}>USD</span>
            </div>
            <p>{plan.tasks}</p>
            <small>{plan.note}</small>
            {isFree ? (
              <Link className={styles.cta} href={ctaHref}>
                {ctaLabel}
              </Link>
            ) : checkoutUrl ? (
              <a
                className={styles.cta}
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {paidCtaLabel}
              </a>
            ) : (
              <button
                type="button"
                className={`${styles.cta} ${styles.ctaDisabled}`}
                disabled
                aria-disabled="true"
              >
                Not yet available
              </button>
            )}
          </article>
        );
      })}
      <p className={styles.note}>{PRICING_NOTE}</p>
    </div>
  );
}

export function PublicPricingFaq() {
  return (
    <section className={styles.faq} aria-labelledby="pricing-faq-title">
      <div>
        <span className={styles.eyebrow}>Pricing FAQ</span>
        <h2 id="pricing-faq-title">Plain answers before you choose.</h2>
      </div>
      <div className={styles.faqList}>
        <details>
          <summary>Is the Free plan a trial?</summary>
          <p>
            Free is $0 and includes 5 tasks during a 30-day trial. The account
            shows the actual state returned by the billing system.
          </p>
        </details>
        <details>
          <summary>What does a task credit cover?</summary>
          <p>
            Credits apply to Work tasks. Chat is a separate conversation
            surface. Work credits are consumed on successful completion; the
            existing backend refund path handles supported failures.
          </p>
        </details>
        <details>
          <summary>Can I cancel or request a refund?</summary>
          <p>
            Cancel through the account billing controls when available. Refund
            eligibility follows the actual billing record and applicable
            policy; this page does not promise an automatic refund outside the
            existing backend behavior.
          </p>
        </details>
      </div>
    </section>
  );
}
