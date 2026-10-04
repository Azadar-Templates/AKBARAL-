import type { Metadata } from 'next';
import { ImagesSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Images — AKBARAL!', robots: { index: false, follow: false } };
export default function ImagesPage() { return <ImagesSurface />; }
