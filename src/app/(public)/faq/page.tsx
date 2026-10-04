import { redirect } from 'next/navigation';

export default function RedirectToLanding() {
  redirect('/');
}
