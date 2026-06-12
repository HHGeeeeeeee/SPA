import { redirect } from 'next/navigation';

// Business Units management now lives inside the Branches page.
export default function BusinessUnitsPage() {
  redirect('/settings/branches');
}
