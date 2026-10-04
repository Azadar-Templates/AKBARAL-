import type { Metadata } from 'next';
import { WorkbenchShell } from '../_components/workbench/workbench-shell';

export const metadata: Metadata = {
  title: 'Task — AKBARAL!',
  description: 'Route a goal through AKBARAL! and receive a verified artifact.',
  robots: { index: false, follow: false },
};

export default function MasterPage() {
  return <WorkbenchShell initialMode="work" />;
}
