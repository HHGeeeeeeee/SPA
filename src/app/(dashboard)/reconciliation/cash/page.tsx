import Link from 'next/link';

import { createServiceClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CashReconForm } from '@/components/reconciliation/cash-recon-form';
import { expectedCashCents } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function CashReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const { data: branches } = await supabase.from('branches').select('id, code, name').eq('active', true).order('code');
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id;
  const date = sp.date || todayPHT();

  let expected = 0;
  let closed: { actual_received_cents: number | null; variance_cents: number | null; variance_reason: string | null } | null = null;
  if (branchId) {
    expected = await expectedCashCents(branchId, date);
    const { data: recon } = await supabase
      .from('cash_reconciliations')
      .select('actual_received_cents, variance_cents, variance_reason, status')
      .eq('branch_id', branchId)
      .eq('reconciliation_date', date)
      .eq('shift_label', 'FullDay')
      .eq('status', 'closed')
      .maybeSingle();
    closed = recon ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Cash Reconciliation</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Count the drawer against expected cash before the day&apos;s Revenue Confirm.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {list.map((b) => (
          <Link
            key={b.id}
            href={`/reconciliation/cash?branch=${b.id}&date=${date}`}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors',
              b.id === branchId ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {b.code}
          </Link>
        ))}
        <form className="ml-auto">
          {branchId && <input type="hidden" name="branch" value={branchId} />}
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm"
          />
        </form>
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base font-bold">{date}</CardTitle></CardHeader>
          <CardContent>
            <CashReconForm branchId={branchId} date={date} expectedCents={expected} closed={closed} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
