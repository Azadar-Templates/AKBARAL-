import type { Metadata } from 'next';
import { WorkbenchShell } from '../_components/workbench/workbench-shell';

export const metadata: Metadata = {
  title: 'Chat & Work — AKBARAL!',
  description: 'Private Chat and verified Work execution in the AKBARAL! application shell.',
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return <WorkbenchShell />;
}
