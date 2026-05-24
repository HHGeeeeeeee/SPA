'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, CalendarCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConfirmableOrder } from '@/app/(dashboard)/reconciliation/revenue-confirm/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function moneyCell(cents: number): string {
  return cents > 0 ? peso(cents) : '—';
}

export function RevenueConfirmHistory({ orders }: { orders: ConfirmableOrder[] }) {
  // Group the closed orders by service date — each date is one daily close.
  const groups = useMemo(() => {
    const m = new Map<string, ConfirmableOrder[]>();
    for (const o of orders) {
      const arr = m.get(o.service_date);
      if (arr) arr.push(o); else m.set(o.service_date, [o]);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, rows]) => ({
        date,
        rows,
        total: rows.reduce((s, o) => s + o.total_cents, 0),
        cash: rows.reduce((s, o) => s + o.cash_cents, 0),
        paymaya: rows.reduce((s, o) => s + o.paymaya_cents, 0),
        ar: rows.reduce((s, o) => s + (o.isAR ? o.total_cents : 0), 0),
      }));
  }, [orders]);

  // Open the most recent day by default.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.length ? [groups[0].date] : []));
  function toggle(date: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n; });
  }

  if (groups.length === 0) {
    return (
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-10 text-center">
          <CalendarCheck className="size-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-semibold text-muted-foreground mt-3">No confirmed orders yet for this branch.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const isOpen = expanded.has(g.date);
        return (
          <Card key={g.date} className="p-0 overflow-hidden">
            <button type="button" onClick={() => toggle(g.date)} className="flex w-full items-center gap-3 px-4 py-3 bg-muted/30 text-left hover:bg-muted/50 transition-colors">
              {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
              <span className="font-bold tabular">{g.date}</span>
              <span className="text-xs font-medium text-muted-foreground">({g.rows.length} order{g.rows.length > 1 ? 's' : ''})</span>
              <span className="ml-auto flex items-center gap-4 text-sm font-semibold text-muted-foreground">
                {g.cash > 0 && <span>Cash {peso(g.cash)}</span>}
                {g.paymaya > 0 && <span>PAYMAYA {peso(g.paymaya)}</span>}
                {g.ar > 0 && <span>AR {peso(g.ar)}</span>}
                <span className="text-base font-extrabold text-foreground">Total: {peso(g.total)}</span>
              </span>
            </button>
            {isOpen && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">Order No</TableHead>
                    <TableHead className="w-28 font-bold">Type</TableHead>
                    <TableHead className="w-16 font-bold text-center">PAX</TableHead>
                    <TableHead className="w-24 font-bold">Settle</TableHead>
                    <TableHead className="font-bold">Billing</TableHead>
                    <TableHead className="w-28 font-bold text-right">Cash</TableHead>
                    <TableHead className="w-28 font-bold text-right">PAYMAYA</TableHead>
                    <TableHead className="w-28 font-bold text-right">AR</TableHead>
                    <TableHead className="w-32 font-bold text-right pr-4">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono font-bold">
                        <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link>
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground text-xs capitalize">{o.order_type.replace('_', ' ')}</TableCell>
                      <TableCell className="font-bold tabular text-center">{o.pax}</TableCell>
                      <TableCell><Badge variant={o.isAR ? 'secondary' : 'default'} className="font-bold">{o.isAR ? 'AR' : 'Paid'}</Badge></TableCell>
                      <TableCell className="font-medium text-muted-foreground">{o.billing_label ?? 'Self-pay'}</TableCell>
                      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.cash_cents)}</TableCell>
                      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.paymaya_cents)}</TableCell>
                      <TableCell className="font-medium tabular text-right text-muted-foreground">{moneyCell(o.isAR ? o.total_cents : 0)}</TableCell>
                      <TableCell className="font-bold tabular text-right pr-4">{peso(o.total_cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
