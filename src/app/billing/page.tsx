import type { Metadata } from 'next';
import { BillingSurface } from '../_components/data-surfaces';

export const metadata: Metadata = {
  title: 'Billing & credits — AKBARAL!',
  description: 'Your real AKBARAL! plan, credits, invoices, payments, and USD pricing.',
  robots: { index: false, follow: false },
};

export default function BillingPage() {
  return <BillingSurface />;
}
