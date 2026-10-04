import type { Metadata } from 'next';
import { ProjectsSurface } from '../_components/data-surfaces';

export const metadata: Metadata = {
  title: 'Projects — AKBARAL!',
  description: 'Your real AKBARAL! projects and honest empty states.',
  robots: { index: false, follow: false },
};

export default function ProjectsPage() {
  return <ProjectsSurface />;
}
