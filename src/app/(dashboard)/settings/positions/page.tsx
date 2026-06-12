import { redirect } from 'next/navigation';

// Positions management now lives inside the Employees page.
export default function PositionsPage() {
  redirect('/settings/employees');
}
