import type { Metadata } from 'next';
import { WorkbenchShell } from '../_components/workbench/workbench-shell';

export const metadata: Metadata = {
  title: 'Chat — AKBARAL!',
  description: 'Chat with AKBARAL! using available provider capacity.',
  robots: { index: false, follow: false },
};

export default function ChatPage() {
  return <WorkbenchShell initialMode="chat" />;
}
