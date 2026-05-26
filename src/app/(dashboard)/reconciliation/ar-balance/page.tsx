import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { loadArBalance } from '@/app/(dashboard)/reconciliation/soa/actions';
import { ArBalanceExplorer } from '@/components/reconciliation/ar-balance-explorer';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export default async function ArBalancePage() {
  const ar = await loadArBalance();
  const overdueNote = ar.overdue_cents > 0 ? ` · ${peso(ar.overdue_cents)} overdue` : '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/reconciliation" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Reconciliation
        </Link>
        <h2 className="text-3xl font-bold tracking-tight mt-1">AR Balance</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Outstanding receivables from open statements + un-stated closed AR · {ar.debtors.length} billing · {peso(ar.total_cents)} outstanding{overdueNote}
        </p>
      </div>

      <ArBalanceExplorer ar={ar} />
    </div>
  );
}
