'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, CalendarCheck, Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConfirmableOrder } from '@/app/(dashboard)/reconciliation/revenue-confirm/actions';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
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
      .map(([date, rows]) => {
        const batches = [...new Set(rows.map((r) => r.gl_batch_nbr).filter((x): x is string => !!x))];
        return {
          date,
          rows,
          total: rows.reduce((s, o) => s + o.total_cents, 0),
          cash: rows.reduce((s, o) => s + o.cash_cents, 0),
          paymaya: rows.reduce((s, o) => s + o.paymaya_cents, 0),
          ar: rows.reduce((s, o) => s + (o.isAR ? o.total_cents : 0), 0),
          tip: rows.reduce((s, o) => s + o.tip_cents, 0),
          batches,
        };
      });
  }, [orders]);

  // Grand totals across every day in the current view (respects the page-level
  // date filter via the orders prop). Sits in the table footer so the desk can
  // glance the period-total without having to add up the day groups.
  const grand = useMemo(() => ({
    cash: groups.reduce((s, g) => s + g.cash, 0),
    paymaya: groups.reduce((s, g) => s + g.paymaya, 0),
    ar: groups.reduce((s, g) => s + g.ar, 0),
    total: groups.reduce((s, g) => s + g.total, 0),
    tip: groups.reduce((s, g) => s + g.tip, 0),
    orderCount: groups.reduce((s, g) => s + g.rows.length, 0),
    dayCount: groups.length,
  }), [groups]);

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
    // Single Card + single Table so the column headers stay visible no matter
    // how many day-groups are collapsed. Each day = one clickable summary row
    // (date + totals under their columns) followed by detail rows when open.
    // Grand totals across all visible days render as a TableFooter.
    <Card className="p-0 overflow-hidden ring-1 ring-border">
      <div className="px-4 py-3 bg-muted/30 border-b border-border text-sm font-semibold">
        Confirmed (Closed) · <span className="tabular">{grand.orderCount}</span> order{grand.orderCount === 1 ? '' : 's'} across <span className="tabular">{grand.dayCount}</span> day{grand.dayCount === 1 ? '' : 's'} · grouped by service date
      </div>
      <Table className="table-fixed">
        {/* Column widths rebalanced: pull slack OUT of the left side (Order No
            / PAX / Settle were oversized for their content) and PUSH it into
            the amount columns, so 5+ digit ₱ values (₱99,999, ₱999,999) keep
            breathing room without crowding the headers. Billing stays flex
            but with much less slack to absorb, so the GL chip + summary
            numbers sit closer to the data they belong to. */}
        <colgroup>
          <col className="w-52" />{/* Order No / Date */}
          <col className="w-14" />{/* PAX */}
          <col className="w-20" />{/* Settle */}
          <col />                 {/* Billing (flex, but now bounded) */}
          <col className="w-32" />{/* Cash */}
          <col className="w-32" />{/* PAYMAYA */}
          <col className="w-32" />{/* AR */}
          <col className="w-36" />{/* Total — widest amount column */}
          <col className="w-32" />{/* Tip */}
        </colgroup>
        <TableHeader>
          {/* Group brackets: SALES (4 cols) + a separate single-column box
              for the tip. Label shortened to "TIPS" so it stops getting
              truncated. */}
          <TableRow>
            <TableHead className="bg-transparent" />
            <TableHead className="bg-transparent" />
            <TableHead className="bg-transparent" />
            <TableHead className="bg-transparent" />
            <TableHead colSpan={4} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 border-x border-border">
              Sales
            </TableHead>
            <TableHead className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 border-r border-border">
              Tips
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead className="font-bold">Date / Order No</TableHead>
            <TableHead className="font-bold text-center">PAX</TableHead>
            <TableHead className="font-bold">Settle</TableHead>
            <TableHead className="font-bold">Billing</TableHead>
            <TableHead className="font-bold text-center bg-muted/30 border-l border-border">Cash</TableHead>
            <TableHead className="font-bold text-center bg-muted/30">PAYMAYA</TableHead>
            <TableHead className="font-bold text-center bg-muted/30">AR</TableHead>
            <TableHead className="font-bold text-right bg-muted/30 border-r border-border">Total</TableHead>
            <TableHead className="font-bold text-right bg-muted/30 border-r border-border pr-4">Tip</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.date);
            return (
              <Fragment key={g.date}>
                {/* Group summary row — always visible, clickable. Numbers sit
                    directly under their column headers thanks to the colgroup. */}
                <TableRow
                  onClick={() => toggle(g.date)}
                  className="cursor-pointer bg-muted/30 hover:bg-muted/40 border-t-2 border-border"
                >
                  <TableCell colSpan={4} className="font-bold">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                      <span className="tabular">{g.date}</span>
                      <span className="text-xs font-medium text-muted-foreground">({g.rows.length} order{g.rows.length > 1 ? 's' : ''})</span>
                      {/* GL voucher # and PDF download are separated:
                          - The chip is a static label (number you copy/read)
                          - The download icon is the actual action */}
                      {g.batches.map((b) => (
                        <Fragment key={b}>
                          <span className="ml-1 inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-bold text-primary font-mono">
                            GL #{b}
                          </span>
                          <a
                            href={`/reconciliation/revenue-confirm/${b}/pdf`}
                            target="_blank"
                            rel="noopener"
                            onClick={(e) => e.stopPropagation()}
                            title={`Download GL #${b} voucher PDF`}
                            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-xs font-bold text-foreground hover:bg-accent transition-colors"
                          >
                            <Download className="size-3" />
                            PDF
                          </a>
                        </Fragment>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="font-bold tabular text-right bg-muted/40 border-l border-border">{moneyCell(g.cash)}</TableCell>
                  <TableCell className="font-bold tabular text-right bg-muted/40">{moneyCell(g.paymaya)}</TableCell>
                  <TableCell className="font-bold tabular text-right bg-muted/40">{moneyCell(g.ar)}</TableCell>
                  <TableCell className="font-extrabold tabular text-right bg-muted/40 border-r border-border">{peso(g.total)}</TableCell>
                  <TableCell className="font-bold tabular text-right bg-muted/40 border-r border-border pr-4">{moneyCell(g.tip)}</TableCell>
                </TableRow>
                {/* Detail rows for this day — only rendered when group is open. */}
                {isOpen && g.rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono font-bold pl-9">
                      <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link>
                    </TableCell>
                    <TableCell className="font-bold tabular text-center">{o.pax}</TableCell>
                    <TableCell><Badge variant={o.isAR ? 'secondary' : 'default'} className="font-bold">{o.isAR ? 'AR' : 'Paid'}</Badge></TableCell>
                    <TableCell className="font-medium text-muted-foreground">{o.billing_label ?? 'Self-pay'}</TableCell>
                    <TableCell className="font-medium tabular text-right text-muted-foreground bg-muted/20 border-l border-border">{moneyCell(o.cash_cents)}</TableCell>
                    <TableCell className="font-medium tabular text-right text-muted-foreground bg-muted/20">{moneyCell(o.paymaya_cents)}</TableCell>
                    <TableCell className="font-medium tabular text-right text-muted-foreground bg-muted/20">{moneyCell(o.isAR ? o.total_cents : 0)}</TableCell>
                    <TableCell className="font-bold tabular text-right bg-muted/20 border-r border-border">{peso(o.total_cents)}</TableCell>
                    <TableCell className="font-medium tabular text-right text-muted-foreground bg-muted/20 border-r border-border pr-4">{moneyCell(o.tip_cents)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
        {/* Grand totals: sums across every visible day, regardless of which
            groups are expanded. Mirrors the day-summary styling (bg-muted/40
            + border-l/r on the Sales / Tips groups) so the bottom line reads
            as the period close-out for whatever filter the user has applied. */}
        <TableFooter>
          <TableRow className="border-t-2 border-border bg-muted/50 hover:bg-muted/50">
            <TableCell colSpan={4} className="font-extrabold uppercase text-xs tracking-wider text-muted-foreground pl-4">
              Grand Totals
              <span className="ml-2 text-muted-foreground/70 normal-case tracking-normal text-[11px]">
                ({grand.orderCount} order{grand.orderCount === 1 ? '' : 's'} · {grand.dayCount} day{grand.dayCount === 1 ? '' : 's'})
              </span>
            </TableCell>
            <TableCell className="font-extrabold tabular text-right bg-muted/60 border-l border-border">{moneyCell(grand.cash)}</TableCell>
            <TableCell className="font-extrabold tabular text-right bg-muted/60">{moneyCell(grand.paymaya)}</TableCell>
            <TableCell className="font-extrabold tabular text-right bg-muted/60">{moneyCell(grand.ar)}</TableCell>
            <TableCell className="font-extrabold tabular text-right bg-muted/60 border-r border-border text-foreground">{peso(grand.total)}</TableCell>
            <TableCell className="font-extrabold tabular text-right bg-muted/60 border-r border-border pr-4">{moneyCell(grand.tip)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
}
