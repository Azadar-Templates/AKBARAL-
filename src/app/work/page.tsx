import type { Metadata } from 'next';
import { WorkbenchShell } from '../_components/workbench/workbench-shell';

export const metadata: Metadata = {
  title: 'Work — AKBARAL!',
  description: 'Route a task through AKBARAL! MASTER and receive a verified artifact.',
  robots: { index: false, follow: false },
};

export default function WorkPage() {
  return <WorkbenchShell initialMode="work" />;
}
