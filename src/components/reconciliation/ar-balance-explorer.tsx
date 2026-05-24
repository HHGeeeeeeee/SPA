'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Banknote } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export interface ArRow {
  id: string;
  order_no: string;
  service_date: string;
  outstanding: number;
  billing_id: string;
  billing_code: string;
  billing_name: string;
  settlement_type: string;
}

const ALL = '__all__';
function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export function ArBalanceExplorer({ rows }: { rows: ArRow[] }) {
  const [q, setQ] = useState('');
  const [billing, setBilling] = useState(ALL);
  const [settlement, setSettlement] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (billing !== ALL && r.billing_code !== billing) return false;
        if (settlement !== ALL && r.settlement_type !== settlement) return false;
        if (from && r.service_date < from) return false;
        if (to && r.service_date > to) return false;
        if (q && !r.order_no.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [rows, q, billing, settlement, from, to],
  );

  const billingItems = [{ value: ALL, label: 'All' }, ...[...new Map(rows.map((r) => [r.billing_code, r.billing_name])).entries()].map(([code, name]) => ({ value: code, label: `${code} — ${name}` }))];
  const settlementItems = [{ value: ALL, label: 'All' }, { value: 'intercompany', label: 'Intercompany' }, { value: 'third_party', label: 'Third-party' }];

  // Group the filtered rows by billing destination.
  const groups = new Map<string, { code: string; name: string; settlement_type: string; outstanding: number; orders: ArRow[] }>();
  let grand = 0;
  for (const r of filtered) {
    grand += r.outstanding;
    const g = groups.get(r.billing_id) ?? { code: r.billing_code, name: r.billing_name, settlement_type: r.settlement_type, outstanding: 0, orders: [] };
    g.outstanding += r.outstanding;
    g.orders.push(r);
    groups.set(r.billing_id, g);
  }
  const list = [...groups.values()].sort((a, b) => b.outstanding - a.outstanding);

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
            <Label className="text-xs font-semibold">Billing</Label>
            <Select items={billingItems} value={billing} onValueChange={(v) => v && setBilling(v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{billingItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Settlement</Label>
            <Select items={settlementItems} value={settlement} onValueChange={(v) => v && setSettlement(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{settlementItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Search</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order no…" className="w-44" />
          </div>
          <p className="ml-auto text-sm font-semibold text-muted-foreground">
            {list.length} billing · {peso(grand)} outstanding
          </p>
        </div>
      </Card>

      {list.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-10 text-center">
            <Banknote className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-semibold text-muted-foreground mt-3">No outstanding AR for these filters.</p>
          </CardContent>
        </Card>
      ) : (
        list.map((g) => (
          <Card key={g.code} className="p-0 overflow-hidden">
            <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <span className="font-mono">{g.code}</span> {g.name}
                <Badge variant="secondary" className="font-bold capitalize">{g.settlement_type.replace('_', '-')}</Badge>
              </CardTitle>
              <span className="text-lg font-extrabold tabular">{peso(g.outstanding)}</span>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold">Order No</TableHead>
                  <TableHead className="w-40 font-bold">Service Date</TableHead>
                  <TableHead className="w-40 font-bold text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono font-bold">
                      <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link>
                    </TableCell>
                    <TableCell className="font-medium tabular">{o.service_date}</TableCell>
                    <TableCell className="font-bold tabular text-right">{peso(o.outstanding)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))
      )}
    </div>
  );
}
