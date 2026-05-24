import Link from 'next/link';
import { Banknote, CheckCircle2, HandCoins, Percent, Wallet, FileText, ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

// /reconciliation has no data of its own — it's the parent of the recon modules.
// Landing hub so the sidebar group never dead-ends on a 404.
const MODULES = [
  { href: '/reconciliation/cash', label: 'Cash Reconciliation', desc: 'Count and confirm the day’s cash drawer against recorded cash payments.', icon: Banknote },
  { href: '/reconciliation/revenue-confirm', label: 'Revenue Confirm', desc: 'Daily close — move paid and AR-completed orders to Closed.', icon: CheckCircle2 },
  { href: '/reconciliation/tips', label: 'Tip Settlement', desc: 'Half-month PAYMAYA tip payout to therapists (to AP).', icon: HandCoins },
  { href: '/reconciliation/commission', label: 'Commission Settlement', desc: 'Therapist commission per period from rendered services.', icon: Percent },
  { href: '/reconciliation/ar-balance', label: 'AR Balance', desc: 'Outstanding AR by billing destination, reconciled against payments.', icon: Wallet },
  { href: '/reconciliation/soa', label: 'Revenue SOA', desc: 'Statements of account for AR billings — intercompany vs third-party.', icon: FileText },
];

export default function ReconciliationHubPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Reconciliation</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Daily cash &amp; revenue close, tips, commission, and AR statements.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => (
          <Link key={m.href} href={m.href}>
            <Card className="p-4 h-full flex items-start gap-3 transition-colors hover:bg-accent">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <m.icon className="size-5" />
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-1 font-bold">
                  {m.label}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mt-0.5">{m.desc}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
