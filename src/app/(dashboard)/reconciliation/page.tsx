import Link from 'next/link';
import { HandCoins, Percent, Wallet, FileText, ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { loadReconStatus } from '@/lib/recon-status';
import { currentSession, isManager } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

export default async function ReconciliationHubPage() {
  const viewerIsManager = isManager(await currentSession());
  const s = await loadReconStatus();

  // tone: 'attention' = amber dot (something to do), 'clear' = green dot.
  // `managerOnly` cards drop off entirely for staff / external booker so the
  // landing only shows the surfaces they can actually open — matches the
  // sidebar's managerOnly filter on the same routes.
  const modules = [
    {
      href: '/reconciliation/tips', label: 'Tip Settlement', icon: HandCoins,
      desc: 'Half-month PAYMAYA tip payout to therapists (to AP).',
      metric: s.openTipsCount > 0 ? `${s.openTipsCount} open tip(s) · ${peso(s.openTipsCents)}` : 'No open tips',
      attention: s.openTipsCount > 0,
      managerOnly: true,
    },
    {
      href: '/reconciliation/commission', label: 'Commission Settlement', icon: Percent,
      desc: 'Therapist commission per period from rendered services.',
      metric: s.unsettledCommissionLines > 0 ? `${s.unsettledCommissionLines} unsettled line(s)` : 'Nothing unsettled',
      attention: s.unsettledCommissionLines > 0,
      managerOnly: true,
    },
    {
      href: '/reconciliation/soa', label: 'Accounts Receivable', icon: Wallet,
      desc: 'Outstanding receivables — open statements + un-stated closed AR, by billing destination.',
      metric: s.arOutstandingCents > 0 ? `${peso(s.arOutstandingCents)} outstanding` : 'Nothing outstanding',
      attention: s.arOutstandingCents > 0,
      managerOnly: true,
    },
    {
      href: '/reconciliation/soa?view=generate', label: 'Generate SOA', icon: FileText,
      desc: 'Bill closed AR into statements — intercompany vs third-party.',
      metric: s.soaUnstated > 0 ? `${s.soaUnstated} closed AR order(s) un-stated` : 'All AR stated',
      attention: s.soaUnstated > 0,
      managerOnly: true,
    },
  ].filter((m) => !m.managerOnly || viewerIsManager);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Reconciliation</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Daily cash &amp; revenue close, tips, commission, and AR statements · live status for {s.today}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <Link key={m.href} href={m.href}>
            <Card className="p-4 h-full flex items-start gap-3 transition-colors hover:bg-accent">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <m.icon className="size-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 font-bold">
                  {m.label}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn('size-2 rounded-full shrink-0', m.attention ? 'bg-amber-500' : 'bg-primary')} />
                  <span className={cn('text-sm font-bold', m.attention ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{m.metric}</span>
                </div>
                <p className="text-xs font-medium text-muted-foreground mt-1">{m.desc}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
