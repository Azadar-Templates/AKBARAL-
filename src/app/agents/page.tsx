import type { Metadata } from 'next';
import { AgentsSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Agents — AKBARAL!', robots: { index: false, follow: false } };
export default function AgentsPage() { return <AgentsSurface />; }
