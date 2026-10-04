import type { Metadata } from 'next';
import { AuthCard } from '../_components/auth-card';

export const metadata: Metadata = {
  title: 'Create account — AKBARAL!',
  description: 'Create your AKBARAL! account with email and password or a configured Google or GitHub provider.',
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <AuthCard mode="signup" />;
}
