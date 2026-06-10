import { redirect } from 'next/navigation';

import { Sidebar } from '@/components/layout/sidebar';
import { SidebarProvider } from '@/components/layout/sidebar-context';
import { TopBar } from '@/components/layout/topbar';
import { currentSession, isAdmin, isManager, isAccountant, isExternalBooker } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');
  // external_booker has no place in the full back-office shell — lock them to /book.
  if (isExternalBooker(session)) redirect('/book');
  const viewerIsAdmin = isAdmin(session);
  const viewerIsManager = isManager(session);
  const viewerIsAccountant = isAccountant(session);

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
        <Sidebar isAdmin={viewerIsAdmin} isManager={viewerIsManager} isAccountant={viewerIsAccountant} />
        <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
          <TopBar userName={session.displayName ?? session.email} />
          <main className="flex-1 overflow-y-auto bg-background spa-pattern p-6 print:overflow-visible print:p-0 print:text-[11px]">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
