import Link from 'next/link';
import { CircleCheck, CircleAlert } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ConfirmRevenueButton } from '@/components/reconciliation/confirm-revenue-button';
import { ReconDatePicker } from '@/components/reconciliation/recon-date-picker';
import { RevenueConfirmHistory } from '@/components/reconciliation/revenue-confirm-history';
import { loadConfirmable, loadConfirmedHistory, isCashClosed, type ConfirmableOrder } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}
function moneyCell(cents: number): string {
  return cents > 0 ? peso(cents) : '—';
}

function OrderRow({ o, showDate }: { o: ConfirmableOrder; showDate?: boolean }) {
  return (
    <TableRow>
      {showDate && <TableCell className="font-medium tabular text-muted-foreground">{o.service_date}</TableCell>}
      <TableCell className="font-mono font-bold">
        <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link>
      </TableCell>
      <TableCell className="font-bold tabular text-center">{o.pax}</TableCell>
      <TableCell><Badge variant={o.isAR ? 'secondary' : 'default'} className="font-bold">{o.isAR ? 'AR' : 'Paid'}</Badge></TableCell>
      <TableCell className="font-medium text-muted-foreground">{o.billing_label ?? 'Self-pay'}</TableCell>
      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.cash_cents)}</TableCell>
      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.paymaya_cents)}</TableCell>
      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.isAR ? o.total_cents : 0)}</TableCell>
      <TableCell className="font-bold tabular text-right pr-4">{peso(o.total_cents)}</TableCell>
    </TableRow>
  );
}

export default async function RevenueConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const branches = await getAllowedBranches();
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id;
  const date = sp.date || todayPHT();
  const view = sp.view === 'history' ? 'history' : 'confirm';

  const cashClosed = branchId && view === 'confirm' ? await isCashClosed(branchId, date) : false;
  const orders = branchId && view === 'confirm' ? await loadConfirmable(branchId, date) : [];
  const history = branchId && view === 'history' ? await loadConfirmedHistory(branchId) : [];
  const total = orders.reduce((s, o) => s + o.total_cents, 0);
  const histTotal = history.reduce((s, o) => s + o.total_cents, 0);
  // Column totals for the footer row
  const cashTotal = orders.reduce((s, o) => s + o.cash_cents, 0);
  const paymayaTotal = orders.reduce((s, o) => s + o.paymaya_cents, 0);
  const arTotal = orders.reduce((s, o) => s + (o.isAR ? o.total_cents : 0), 0);

  const tabLink = (v: 'confirm' | 'history') => `/reconciliation/revenue-confirm?branch=${branchId}&date=${date}&view=${v}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reconciliation" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reconciliation</Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Revenue Confirm</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            Daily close — moves Paid and AR-Completed orders to Closed. (ERP posting wired later.)
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shrink-0">
          <Link href={tabLink('confirm')} className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', view === 'confirm' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>Confirm</Link>
          <Link href={tabLink('history')} className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', view === 'history' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>History</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {list.map((b) => (
          <Link
            key={b.id}
            href={`/reconciliation/revenue-confirm?branch=${b.id}&date=${date}&view=${view}`}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors',
              b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {b.code}
          </Link>
        ))}
        {view === 'confirm' && (
          <div className="ml-auto">
            <ReconDatePicker basePath="/reconciliation/revenue-confirm" branchId={branchId} date={date} />
          </div>
        )}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : view === 'history' ? (
        <>
          <p className="text-sm font-semibold text-muted-foreground -mb-2">
            Confirmed (Closed) · {history.length} order(s) · {peso(histTotal)} · grouped by service date
          </p>
          <RevenueConfirmHistory orders={history} />
        </>
      ) : (
        <>
          <Card className={cn('border', cashClosed ? 'border-primary/30' : 'border-destructive/40')}>
            <CardContent className="py-3 flex items-center gap-2 text-sm font-semibold">
              {cashClosed ? (
                <><CircleCheck className="size-4 text-primary" /> Shift cash count closed — ready to confirm.</>
              ) : (
                <><CircleAlert className="size-4 text-destructive" /> Shift cash count not closed for this day.{' '}
                  <Link href={`/reconciliation/cash?branch=${branchId}&date=${date}`} className="underline">Go to Shift Cash Count</Link></>
              )}
            </CardContent>
          </Card>

          <Card className="p-0 overflow-hidden">
            <CardHeader className="flex-row items-center justify-between p-4">
              <CardTitle className="text-base font-bold">{date} · {orders.length} order(s) · {peso(total)}</CardTitle>
              <ConfirmRevenueButton branchId={branchId} date={date} count={orders.length} disabled={!cashClosed} />
            </CardHeader>
            <Table className="table-fixed">
              {/* Pin Order No to its content width (~22 chars) — without this
                  it absorbs ~half the table width via auto-layout slack and
                  leaves a huge gap to PAX. Amount columns widened so 5-digit
                  totals (₱99,999) still have breathing room. */}
              <TableHeader>
                <TableRow>
                  <TableHead className="w-56 font-bold">Order No</TableHead>
                  <TableHead className="w-16 font-bold text-center">PAX</TableHead>
                  <TableHead className="w-24 font-bold">Settle</TableHead>
                  <TableHead className="font-bold">Billing</TableHead>
                  <TableHead className="w-32 font-bold text-center">Cash</TableHead>
                  <TableHead className="w-32 font-bold text-center">PAYMAYA</TableHead>
                  <TableHead className="w-32 font-bold text-center">AR</TableHead>
                  <TableHead className="w-32 font-bold text-right pr-4">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm font-semibold text-muted-foreground">No orders pending confirmation for this branch/day.</TableCell></TableRow>
                ) : (
                  <>
                    {orders.map((o) => <OrderRow key={o.id} o={o} />)}
                    {/* Totals footer: aligned with Cash / PAYMAYA / AR / Total columns. */}
                    <TableRow className="border-t-2 border-border bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={4} className="font-bold text-right pr-3">Totals</TableCell>
                      <TableCell className="font-bold tabular text-right">{moneyCell(cashTotal)}</TableCell>
                      <TableCell className="font-bold tabular text-right">{moneyCell(paymayaTotal)}</TableCell>
                      <TableCell className="font-bold tabular text-right">{moneyCell(arTotal)}</TableCell>
                      <TableCell className="font-extrabold tabular text-right pr-4">{peso(total)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
