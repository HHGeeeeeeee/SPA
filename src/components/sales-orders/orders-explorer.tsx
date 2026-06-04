'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Receipt } from 'lucide-react';

import { ServiceBadge, PaymentBadge, orderPaymentState } from '@/components/sales-orders/order-badges';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  order_type: string;
  service_date: string;
  total_cents: number;
  paid_cents: number;
  is_ar: boolean;
  branch_code: string;
  billing_code: string | null;
  pax: number;
  cash_cents: number;
  paymaya_cents: number;
  ar_cents: number;
  tip_cents: number;
}

// Service / lifecycle axis. `completed` + `paid` both read as "Service done"
// now, so they collapse into one filter option — payment is filtered separately.
const SERVICE_OPTIONS: { value: string; label: string; match: (s: string) => boolean }[] = [
  { value: 'draft', label: 'Draft', match: (s) => s === 'draft' },
  { value: 'open', label: 'Open', match: (s) => s === 'open' },
  { value: 'in_service', label: 'In service', match: (s) => s === 'in_service' },
  { value: 'done', label: 'Service done', match: (s) => s === 'completed' || s === 'paid' },
  { value: 'closed', label: 'Closed', match: (s) => s === 'closed' },
  { value: 'void', label: 'Void', match: (s) => s === 'void' },
];
// Payment axis. "Owing" (unpaid OR partial) is the one a manager reaches for.
const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'owing', label: 'Owing' },
  { value: 'paid', label: 'Paid' },
  { value: 'ar', label: 'AR' },
];
const ALL = '__all__';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function OrdersExplorer({ rows, billingCodes }: { rows: OrderRow[]; billingCodes: string[] }) {
  const today = todayPHT();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [billing, setBilling] = useState(ALL);
  const [service, setService] = useState(ALL);
  const [payment, setPayment] = useState(ALL);

  const filtered = useMemo(
    () =>
      rows.filter((o) => {
        if (from && o.service_date < from) return false;
        if (to && o.service_date > to) return false;
        if (billing !== ALL && o.billing_code !== billing) return false;
        if (service !== ALL && !SERVICE_OPTIONS.find((x) => x.value === service)?.match(o.status)) return false;
        if (payment !== ALL) {
          // Drafts aren't classified by payment state (the cashier is still
          // composing) — exclude them from any payment filter. Matches the
          // badge + outstanding cell which both stay silent for drafts.
          if (o.status === 'draft') return false;
          const st = orderPaymentState(o);
          const ok = payment === 'owing' ? st === 'unpaid' || st === 'partial' : st === payment;
          if (!ok) return false;
        }
        return true;
      }),
    [rows, from, to, billing, service, payment],
  );

  // Column sums for the footer — only over what's currently filtered/visible.
  const totals = useMemo(
    () =>
      filtered.reduce(
        (a, o) => {
          a.cash += o.cash_cents;
          a.paymaya += o.paymaya_cents;
          a.ar += o.ar_cents;
          // Mirror outstandingCell: drafts aren't real liabilities, don't add to total.
          a.outstanding += o.is_ar || o.status === 'draft' ? 0 : Math.max(0, o.total_cents - o.paid_cents);
          a.total += o.total_cents;
          a.tip += o.tip_cents;
          return a;
        },
        { cash: 0, paymaya: 0, ar: 0, outstanding: 0, total: 0, tip: 0 },
      ),
    [filtered],
  );

  // Base UI's <SelectValue /> needs an items map to show labels in the trigger
  // (otherwise it prints the raw value, e.g. "__all__").
  const billingItems = [{ value: ALL, label: 'All' }, ...billingCodes.map((c) => ({ value: c, label: c }))];
  const serviceItems = [{ value: ALL, label: 'All' }, ...SERVICE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))];
  const paymentItems = [{ value: ALL, label: 'All' }, ...PAYMENT_OPTIONS.map((s) => ({ value: s.value, label: s.label }))];

  const moneyCell = (cents: number, cls = '') =>
    cents > 0 ? <span className={cls}>{peso(cents)}</span> : <span className="text-muted-foreground">—</span>;
  // Uncollected at the counter. Red when service is done but money's still out
  // (the concern); calmer grey while the order is still in progress; — for AR
  // (billed monthly), fully-paid orders, and DRAFTS (the line items aren't
  // committed yet — a draft is the cashier still editing the order, not money
  // the customer owes us). Drafts are caught by EoD's runOrderReview, not by
  // the outstanding total here.
  const outstandingCell = (o: OrderRow) => {
    const due = o.is_ar || o.status === 'draft' ? 0 : Math.max(0, o.total_cents - o.paid_cents);
    if (due === 0) return <span className="text-muted-foreground">—</span>;
    return <span className={o.status === 'completed' ? 'font-bold text-destructive' : 'font-medium text-muted-foreground'}>{peso(due)}</span>;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Date From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Date To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Billing To</Label>
            <Select items={billingItems} value={billing} onValueChange={(v) => v && setBilling(v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {billingCodes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Stage</Label>
            <Select items={serviceItems} value={service} onValueChange={(v) => v && setService(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {SERVICE_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Payment</Label>
            <Select items={paymentItems} value={payment} onValueChange={(v) => v && setPayment(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {PAYMENT_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            {/* Group header brackets the three payment-method columns as one set. */}
            <TableRow>
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
              <TableHead colSpan={3} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 border-x border-border">
                Payments
              </TableHead>
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
              <TableHead className="bg-transparent" />
            </TableRow>
            <TableRow>
              <TableHead className="w-20 font-bold">Branch</TableHead>
              <TableHead className="w-32 font-bold">Service Date</TableHead>
              <TableHead className="w-20 font-bold">Order No</TableHead>
              <TableHead className="w-24 font-bold">Billing To</TableHead>
              <TableHead className="w-16 font-bold">PAX</TableHead>
              <TableHead className="w-28 font-bold text-center bg-muted/30 border-l border-border">Cash</TableHead>
              <TableHead className="w-28 font-bold text-center bg-muted/30">Paymaya</TableHead>
              <TableHead className="w-28 font-bold text-center bg-muted/30 border-r border-border">AR</TableHead>
              <TableHead className="w-32 font-bold text-center">Outstanding</TableHead>
              <TableHead className="w-32 font-bold text-center">Total</TableHead>
              <TableHead className="w-24 font-bold text-center">Tips</TableHead>
              <TableHead className="w-36 font-bold text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-16">
                  <Receipt className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">No orders match these filters.</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((o) => (
                <TableRow key={o.id} className="cursor-pointer">
                  <TableCell className="font-mono font-bold">{o.branch_code}</TableCell>
                  <TableCell className="font-medium tabular">{o.service_date}</TableCell>
                  <TableCell className="font-mono font-bold">
                    {/* Show just the daily sequence (last segment, e.g. 0002).
                        Full SO-YYMMDD-NNNN stays as the hover tooltip. */}
                    <Link href={`/sales-orders/${o.id}`} className="hover:text-primary" title={o.order_no}>{o.order_no.split('-').pop()}</Link>
                  </TableCell>
                  <TableCell className="font-mono font-bold text-xs">{o.billing_code ?? '—'}</TableCell>
                  <TableCell className="font-bold tabular">{o.pax}</TableCell>
                  <TableCell className="font-medium tabular text-right bg-muted/20 border-l border-border">{moneyCell(o.cash_cents)}</TableCell>
                  <TableCell className="font-medium tabular text-right bg-muted/20">{moneyCell(o.paymaya_cents)}</TableCell>
                  <TableCell className="font-medium tabular text-right bg-muted/20 border-r border-border">{moneyCell(o.ar_cents)}</TableCell>
                  <TableCell className="tabular text-right">{outstandingCell(o)}</TableCell>
                  <TableCell className="font-bold tabular text-right">{peso(o.total_cents)}</TableCell>
                  <TableCell className="font-medium tabular text-right">{moneyCell(o.tip_cents, 'text-primary')}</TableCell>
                  <TableCell>
                    {/* Two axes: service/lifecycle badge + derived payment badge,
                        so a green "Service done" is never read as "paid". */}
                    <div className="flex flex-col items-center gap-1">
                      <ServiceBadge status={o.status} />
                      <PaymentBadge total_cents={o.total_cents} paid_cents={o.paid_cents} is_ar={o.is_ar} status={o.status} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {filtered.length > 0 && (
            <TableFooter>
              {/* Column sums, aligned under the money columns above. */}
              <TableRow className="border-t-2 border-border bg-muted/40 font-bold">
                <TableCell colSpan={5} className="text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Totals · {filtered.length} order{filtered.length === 1 ? '' : 's'}
                </TableCell>
                <TableCell className="tabular text-right bg-muted/30 border-l border-border">{moneyCell(totals.cash)}</TableCell>
                <TableCell className="tabular text-right bg-muted/30">{moneyCell(totals.paymaya)}</TableCell>
                <TableCell className="tabular text-right bg-muted/30 border-r border-border">{moneyCell(totals.ar)}</TableCell>
                <TableCell className="tabular text-right">
                  {totals.outstanding > 0 ? <span className="text-destructive">{peso(totals.outstanding)}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="tabular text-right">{peso(totals.total)}</TableCell>
                <TableCell className="tabular text-right">{moneyCell(totals.tip, 'text-primary')}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>
    </div>
  );
}
