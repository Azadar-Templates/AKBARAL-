import type { Metadata } from 'next';
import { HelpSurface } from '../_components/data-surfaces';

export const metadata: Metadata = { title: 'Help — AKBARAL!', description: 'Short AKBARAL! help for Chat, Task, credits, files, settings, and billing.' };
export default function HelpPage() { return <HelpSurface />; }
