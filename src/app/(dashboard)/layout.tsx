import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/topbar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO: Auth check — redirect to /login if no session.
  // const session = await readSession();
  // if (!session) redirect('/login');

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar userName="Demo User" />
        <main className="flex-1 overflow-y-auto bg-background spa-pattern p-6">{children}</main>
      </div>
    </div>
  );
}
