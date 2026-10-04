import type { Metadata } from 'next';
import { SettingsSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Settings — AKBARAL!', robots: { index: false, follow: false } };
export default function SettingsPage() { return <SettingsSurface />; }
