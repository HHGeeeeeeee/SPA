import Link from 'next/link';
import { CircleCheck, CircleAlert } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
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
import { loadConfirmable, isCashClosed } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function moneyCell(cents: number): string {
  return cents > 0 ? peso(cents) : '—';
}

export default async function RevenueConfirmPage({
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

  const cashClosed = branchId ? await isCashClosed(branchId, date) : false;
  const orders = branchId ? await loadConfirmable(branchId, date) : [];
  const total = orders.reduce((s, o) => s + o.total_cents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Revenue Confirm</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Daily close — moves Paid and AR-Completed orders to Closed. (ERP posting wired later.)
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {list.map((b) => (
          <Link
            key={b.id}
            href={`/reconciliation/revenue-confirm?branch=${b.id}&date=${date}`}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors',
              b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {b.code}
          </Link>
        ))}
        <div className="ml-auto">
          <ReconDatePicker basePath="/reconciliation/revenue-confirm" branchId={branchId} date={date} />
        </div>
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : (
        <>
          <Card className={cn('border', cashClosed ? 'border-primary/30' : 'border-destructive/40')}>
            <CardContent className="py-3 flex items-center gap-2 text-sm font-semibold">
              {cashClosed ? (
                <><CircleCheck className="size-4 text-primary" /> Cash reconciliation closed — ready to confirm.</>
              ) : (
                <><CircleAlert className="size-4 text-destructive" /> Cash reconciliation not closed for this day.{' '}
                  <Link href={`/reconciliation/cash?branch=${branchId}&date=${date}`} className="underline">Go to Cash Reconciliation</Link></>
              )}
            </CardContent>
          </Card>

          <Card className="p-0 overflow-hidden">
            <CardHeader className="flex-row items-center justify-between p-4">
              <CardTitle className="text-base font-bold">{date} · {orders.length} order(s) · {peso(total)}</CardTitle>
              <ConfirmRevenueButton branchId={branchId} date={date} count={orders.length} disabled={!cashClosed} />
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold">Order No</TableHead>
                  <TableHead className="font-bold">Type</TableHead>
                  <TableHead className="font-bold">Billing</TableHead>
                  <TableHead className="w-28 font-bold text-right">Cash</TableHead>
                  <TableHead className="w-28 font-bold text-right">PAYMAYA</TableHead>
                  <TableHead className="w-32 font-bold text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm font-semibold text-muted-foreground">No orders pending confirmation for this branch/day.</TableCell></TableRow>
                ) : (
                  orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono font-bold">
                        <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={o.isAR ? 'secondary' : 'default'} className="font-bold">{o.isAR ? 'AR' : 'Paid'}</Badge>
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground">{o.billing_label ?? 'Self-pay'}</TableCell>
                      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.cash_cents)}</TableCell>
                      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.paymaya_cents)}</TableCell>
                      <TableCell className="font-bold tabular text-right">{peso(o.total_cents)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
