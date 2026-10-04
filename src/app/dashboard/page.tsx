import type { Metadata } from 'next';
import { DashboardSurface } from '../_components/data-surfaces';

export const metadata: Metadata = {
  title: 'Dashboard — AKBARAL!',
  description: 'Your AKBARAL! plan, Work credits, completed tasks, cycle reset, recent Work, recent chats, role, sessions, and plan comparison.',
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return <DashboardSurface />;
}
