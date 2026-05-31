'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Banknote, FileText } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { CashDetailRow } from '@/app/(dashboard)/reconciliation/cash/actions';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface Props {
  rows: CashDetailRow[];
}

// Collapsible per-transaction list of every cash payment counted into today's
// shifts. Hand-rolled (no Collapsible primitive in src/components/ui), one
// chevron-toggle button as the card header. Starts collapsed — the cashier
// only opens it when chasing a variance.
export function CashDetailCard({ rows }: Props) {
  const [open, setOpen] = useState(false);
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const counter = rows.filter((r) => r.kind === 'order').reduce((s, r) => s + r.amountCents, 0);
  const ar = total - counter;

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
      >
        <ChevronDown
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
          strokeWidth={2}
        />
        <span className="font-bold text-sm">Cash detail</span>
        <span className="text-xs font-medium text-muted-foreground">
          {rows.length} transaction{rows.length === 1 ? '' : 's'} · ₱{peso(total)}
        </span>
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular">
          SO ₱{peso(counter)} · AR ₱{peso(ar)}
        </span>
      </button>

      {open && (
        rows.length === 0 ? (
          <div className="border-t border-border px-4 py-6 text-center text-sm font-medium text-muted-foreground">
            No cash transactions today.
          </div>
        ) : (
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20 font-bold">Time</TableHead>
                  <TableHead className="w-28 font-bold">Shift</TableHead>
                  <TableHead className="w-24 font-bold">Source</TableHead>
                  <TableHead className="font-bold">Reference</TableHead>
                  <TableHead className="font-bold">Detail</TableHead>
                  <TableHead className="w-28 text-right font-bold">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.kind}-${r.refId}-${i}`}>
                    <TableCell className="font-mono font-semibold tabular text-xs">
                      {hhmm(r.paidAt)}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{r.shiftLabel}</TableCell>
                    <TableCell>
                      {r.kind === 'order' ? (
                        <Badge variant="secondary" className="font-bold gap-1">
                          <Banknote className="size-3" />
                          SO
                        </Badge>
                      ) : (
                        <Badge variant="default" className="font-bold gap-1">
                          <FileText className="size-3" />
                          AR
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono font-bold text-xs">
                      {r.kind === 'order' ? (
                        <Link className="hover:text-primary" href={`/sales-orders/${r.refId}`}>
                          {r.refNo}
                        </Link>
                      ) : (
                        <Link className="hover:text-primary" href={`/reconciliation/soa?id=${r.refId}`}>
                          {r.refNo}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{r.refLabel}</TableCell>
                    <TableCell className="text-right font-bold tabular">
                      {peso(r.amountCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </Card>
  );
}
