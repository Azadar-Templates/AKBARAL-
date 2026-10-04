import type { Metadata } from 'next';
import { AuthCard } from '../_components/auth-card';

export const metadata: Metadata = {
  title: 'Sign in — AKBARAL!',
  description: 'Sign in to AKBARAL! with email and password or a configured Google or GitHub provider.',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return <AuthCard mode="signin" />;
}
