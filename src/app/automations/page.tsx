import type { Metadata } from 'next';
import { AutomationsSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Automations — AKBARAL!', robots: { index: false, follow: false } };
export default function AutomationsPage() { return <AutomationsSurface />; }
