import type { Metadata } from 'next';
import { FilesSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Files & documents — AKBARAL!', robots: { index: false, follow: false } };
export default function FilesPage() { return <FilesSurface />; }
