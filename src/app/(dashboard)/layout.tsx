import { redirect } from 'next/navigation';

import { Sidebar } from '@/components/layout/sidebar';
import { SidebarProvider } from '@/components/layout/sidebar-context';
import { TopBar } from '@/components/layout/topbar';
import { currentSession, isAdmin, isManager } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');
  const viewerIsAdmin = isAdmin(session);
  const viewerIsManager = isManager(session);

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar isAdmin={viewerIsAdmin} isManager={viewerIsManager} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar userName={session.displayName ?? session.email} />
          <main className="flex-1 overflow-y-auto bg-background spa-pattern p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
