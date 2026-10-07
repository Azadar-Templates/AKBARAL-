import type { Metadata } from 'next';
import { PublicPricingFaq, PublicPricingTable } from '../_components/public-pricing';
import { PublicSiteFooter, PublicSiteHeader } from '../_components/public-site-chrome';
import styles from '../(public)/public-info.module.css';

export const metadata: Metadata = { title: 'Pricing — AKBARAL!', description: 'AKBARAL! pricing in USD: Free $0, Starter $10, Pro $50, Business $90, Scale $200, Enterprise $400.' };

export default function PricingPage() {
  return <main className={styles.page}><PublicSiteHeader /><div className={styles.pageBody}>
    <div className={styles.heading}><span>Pricing</span><h1>Capacity that stays legible.</h1><p>Six USD plans, one published table, and no invented quotas. Choose the capacity that matches the work you actually expect to run.</p></div>
    <section id="pricing" aria-labelledby="pricing-title"><h2 id="pricing-title" className={styles.srOnly}>AKBARAL! six-plan pricing</h2><PublicPricingTable /></section>
    <div className={styles.pricingFaqWrap}><PublicPricingFaq /></div>
  </div><PublicSiteFooter /></main>;
}
