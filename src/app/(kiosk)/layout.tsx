// The kiosk shell — deliberately NOT the (dashboard) layout: no sidebar, no
// topbar, no back-office surface. A public, full-screen tablet page. Auth is
// handled by the per-branch kiosk passcode (armed cookie), not a login.
export const dynamic = 'force-dynamic';

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background bg-gradient-to-b from-[#3E6352]/12 via-[#3E6352]/4 to-transparent text-foreground">
      {children}
    </div>
  );
}
