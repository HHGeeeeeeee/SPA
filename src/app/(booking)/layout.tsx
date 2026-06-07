import { redirect } from 'next/navigation';
import { CalendarClock } from 'lucide-react';

import { currentSession, isExternalBooker } from '@/lib/auth';
import { SignOutButton } from '@/components/booking/sign-out-button';

export const dynamic = 'force-dynamic';

// The external_booker shell — deliberately NOT the (dashboard) layout: no
// sidebar, no topbar, no back-office surface. Only external_booker lives here;
// anyone else who lands on /book is sent back to their dashboard.
export default async function BookingLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (!isExternalBooker(session)) redirect('/dashboard');

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <CalendarClock className="size-5 text-primary" />
        <span className="text-base font-bold">HHG-SPA Booking</span>
        <span className="ml-auto text-sm font-semibold text-muted-foreground">{session.displayName ?? session.email}</span>
        <SignOutButton />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">{children}</main>
    </div>
  );
}