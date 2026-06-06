'use client';

import Link from 'next/link';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ShiftRevenueLine, ShiftFolioLine } from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

function peso(c: number): string {
  return (c / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function tm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
}

// Posted revenue vs Collected payments as two tabs so the page stays compact as
// the lines grow.
export function ShiftLinesTabs({ revenueLines, folioLines }: { revenueLines: ShiftRevenueLine[]; folioLines: ShiftFolioLine[] }) {
  return (
    <Tabs defaultValue="revenue">
      <TabsList>
        <TabsTrigger value="revenue">Posted revenue ({revenueLines.length})</TabsTrigger>
        <TabsTrigger value="payments">Collected payments ({folioLines.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="revenue">
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revenueLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm font-medium text-muted-foreground">No revenue posted in this shift.</TableCell>
                </TableRow>
              ) : (
                revenueLines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">{tm(l.postedAt)}</TableCell>
                    <TableCell>
                      {l.orderId
                        ? <Link href={`/sales-orders/${l.orderId}`} className="font-semibold underline underline-offset-2">{l.orderNo ?? '—'}</Link>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-medium">{l.category}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{peso(l.amountCents)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="payments">
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folioLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm font-medium text-muted-foreground">No payments collected in this shift.</TableCell>
                </TableRow>
              ) : (
                folioLines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">{tm(l.postedAt)}</TableCell>
                    <TableCell>
                      {l.orderId
                        ? <Link href={`/sales-orders/${l.orderId}`} className="font-semibold underline underline-offset-2">{l.orderNo ?? '—'}</Link>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-medium">{l.method ?? '—'}{l.kind === 'refund' ? <span className="ml-1 text-[10px] font-bold uppercase text-destructive">refund</span> : null}</TableCell>
                    <TableCell className="text-muted-foreground">{l.ref ?? '—'}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${l.kind === 'refund' ? 'text-destructive' : ''}`}>{l.kind === 'refund' ? '-' : ''}{peso(l.amountCents)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}
