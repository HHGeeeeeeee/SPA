'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Receipt } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
  branch_code: string;
  billing_code: string | null;
  pax: number;
  cash_cents: number;
  paymaya_cents: number;
  tip_cents: number;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  reserved: 'secondary', draft: 'secondary', open: 'default', in_service: 'default',
  completed: 'default', posting: 'secondary', paid: 'default', closed: 'secondary', void: 'destructive',
};
const STATUS_OPTIONS = ['draft', 'open', 'in_service', 'completed', 'paid', 'closed', 'void'];
const ALL = '__all__';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function OrdersExplorer({ rows, billingCodes }: { rows: OrderRow[]; billingCodes: string[] }) {
  const today = todayPHT();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [typeQ, setTypeQ] = useState('');
  const [billing, setBilling] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const filtered = useMemo(
    () =>
      rows.filter((o) => {
        if (from && o.service_date < from) return false;
        if (to && o.service_date > to) return false;
        if (typeQ && !o.order_type.toLowerCase().includes(typeQ.toLowerCase())) return false;
        if (billing !== ALL && o.billing_code !== billing) return false;
        if (status !== ALL && o.status !== status) return false;
        return true;
      }),
    [rows, from, to, typeQ, billing, status],
  );

  const moneyCell = (cents: number, cls = '') =>
    cents > 0 ? <span className={cls}>{peso(cents)}</span> : <span className="text-muted-foreground">—</span>;

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
            <Label className="text-xs font-semibold">Type</Label>
            <Input value={typeQ} onChange={(e) => setTypeQ(e.target.value)} placeholder="Search type…" className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Billing To</Label>
            <Select value={billing} onValueChange={(v) => v && setBilling(v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {billingCodes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56 font-bold">Order No</TableHead>
              <TableHead className="w-20 font-bold">Branch</TableHead>
              <TableHead className="w-28 font-bold">Type</TableHead>
              <TableHead className="w-24 font-bold">Billing To</TableHead>
              <TableHead className="w-16 font-bold">PAX</TableHead>
              <TableHead className="w-32 font-bold">Service Date</TableHead>
              <TableHead className="w-28 font-bold text-right">Cash</TableHead>
              <TableHead className="w-28 font-bold text-right">Paymaya</TableHead>
              <TableHead className="w-32 font-bold text-right">Total</TableHead>
              <TableHead className="w-24 font-bold text-right">Tips</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-16">
                  <Receipt className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">No orders match these filters.</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((o) => (
                <TableRow key={o.id} className="cursor-pointer">
                  <TableCell className="font-mono font-bold">
                    <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link>
                  </TableCell>
                  <TableCell className="font-mono font-bold">{o.branch_code}</TableCell>
                  <TableCell className="font-medium text-muted-foreground text-xs">{o.order_type}</TableCell>
                  <TableCell className="font-mono font-bold text-xs">{o.billing_code ?? '—'}</TableCell>
                  <TableCell className="font-bold tabular">{o.pax}</TableCell>
                  <TableCell className="font-medium tabular">{o.service_date}</TableCell>
                  <TableCell className="font-medium tabular text-right">{moneyCell(o.cash_cents)}</TableCell>
                  <TableCell className="font-medium tabular text-right">{moneyCell(o.paymaya_cents)}</TableCell>
                  <TableCell className="font-bold tabular text-right">{peso(o.total_cents)}</TableCell>
                  <TableCell className="font-medium tabular text-right">{moneyCell(o.tip_cents, 'text-primary')}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[o.status] ?? 'secondary'} className="font-bold capitalize">
                      {o.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
