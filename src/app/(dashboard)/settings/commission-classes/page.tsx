import { redirect } from 'next/navigation';

// Commission Classes management now lives inside the Commission Policies page.
export default function CommissionClassesPage() {
  redirect('/settings/commission-policies');
}
