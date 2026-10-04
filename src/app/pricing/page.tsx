import type { Metadata } from 'next';
import { PricingSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Pricing — AKBARAL!', description: 'AKBARAL! pricing in USD: Free $0, Starter $10, Pro $50, Business $90, Scale $200, Enterprise $400.' };
export default function PricingPage() { return <PricingSurface />; }
