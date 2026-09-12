import type { Metadata } from 'next';
import { SitePage } from '../../_components/site-chrome';

export const metadata: Metadata = {
  title: 'Pricing — AKBARAL!',
  description:
    'Simple credit-based pricing: Free trial with 5 tasks, then Starter $10, Pro $50, Business $90, Scale $200 and Enterprise $400 per month. Manual credit purchase available. No hidden consumption.',
};

/**
 * Plan data mirrors the production `plans` table (seed + migration 0013,
 * pricing tiers LOCKED: $0/$10/$50/$90/$200/$400). Do not change one without
 * the other — this page documents the real entitlements the API enforces.
 */
const PLANS = [
  {
    key: 'free', name: 'Free Trial', price: '$0', interval: '30-day trial',
    desc: 'Try real execution with 5 free tasks. No card required.',
    features: ['5 free tasks (consumed only on success)', '3 saved agents', '1 workspace, 1 seat', 'Full pipeline: plan → execute → verify', '30-day trial'],
    cta: 'Start Free', href: '/#/register',
  },
  {
    key: 'starter', name: 'Starter', price: '$10', interval: '/month',
    desc: 'For individuals putting their first agents to work.',
    features: ['25 task credits per month', '10 saved agents', '1 workspace, 1 seat', 'Custom credit purchase', 'Email support'],
    cta: 'Choose Starter', href: '/#/register',
  },
  {
    key: 'pro', name: 'Pro', price: '$50', interval: '/month',
    desc: 'For professionals running regular multi-agent work.',
    features: ['100 task credits per month', '50 saved agents', 'Custom credit purchase', 'Priority queue position', 'Email support'],
    cta: 'Choose Pro', href: '/#/register',
  },
  {
    key: 'business', name: 'Business', price: '$90', interval: '/month',
    desc: 'For teams running continuous multi-agent operations.',
    features: ['250 task credits per month', '150 saved agents', '15 workspaces, 10 seats', 'Agent Factory publishing', 'Team features + API access'],
    cta: 'Choose Business', href: '/#/register', featured: true,
  },
  {
    key: 'scale', name: 'Scale', price: '$200', interval: '/month',
    desc: 'High-volume execution, automation and throughput.',
    features: ['750 task credits per month', '500 saved agents', 'Automation-heavy workloads', 'Custom credit purchase', 'Priority support'],
    cta: 'Choose Scale', href: '/#/register',
  },
  {
    key: 'enterprise', name: 'Enterprise', price: '$400', interval: '/month',
    desc: 'Maximum capacity for always-on agent fleets.',
    features: ['2,000 task credits per month', '10,000 saved agents', 'Unlimited-scale agent fleets', 'Custom credit purchase', 'Priority support'],
    cta: 'Choose Enterprise', href: '/#/register',
  },
];

export default function PricingPage() {
  return (
    <SitePage currentPath="/pricing">
      <section className="pk-hero">
        <span className="pk-kicker">Pricing</span>
        <h1>Credits that respect your work</h1>
        <p>
          A task credit is consumed only when a task completes successfully. If the
          platform cannot complete your task, the credit is restored and you are told why.
        </p>
      </section>

      <div className="pk-page">
        <section className="pk-section" aria-label="Plans">
          <div className="pk-plans">
            {PLANS.map((plan) => (
              <article key={plan.key} className="pk-plan" data-featured={plan.featured ? '' : undefined}>
                <h3>{plan.name}</h3>
                <div className="pk-price">{plan.price} <small>{plan.interval}</small></div>
                <p className="pk-plan-desc">{plan.desc}</p>
                <ul>
                  {plan.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <a className="pk-btn pk-btn-primary" href={plan.href}>{plan.cta}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="pk-section" aria-labelledby="credits-h">
          <h2 id="credits-h">How credits actually work</h2>
          <div className="pk-grid pk-grid-3">
            <article className="pk-card">
              <h3><span className="pk-ico" aria-hidden="true">✓</span>Success-based</h3>
              <p>A credit is consumed only after a task completes and passes verification. Failed tasks restore the credit automatically.</p>
            </article>
            <article className="pk-card">
              <h3><span className="pk-ico" aria-hidden="true">↺</span>Refund drill tested</h3>
              <p>The credit engine&apos;s consume/refund path is idempotent and covered by automated tests — double-refunds and double-consumes cannot happen.</p>
            </article>
            <article className="pk-card">
              <h3><span className="pk-ico" aria-hidden="true">＋</span>Manual top-ups</h3>
              <p>Need more capacity without changing plans? Request a custom credit purchase; an administrator reviews it and your balance updates after approval.</p>
            </article>
          </div>
          <div className="pk-note">
            Payment processing note: card checkout activates when a payment provider is
            configured for your account. Until then, subscription changes and credit
            purchases are reviewed manually — nothing is charged silently.
          </div>
        </section>
      </div>
    </SitePage>
  );
}
