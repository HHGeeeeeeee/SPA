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
// the lines grow. In print mode both sections render sequentially (tabs hidden).
export function ShiftLinesTabs({ revenueLines, folioLines }: { revenueLines: ShiftRevenueLine[]; folioLines: ShiftFolioLine[] }) {
  return (
    <Tabs defaultValue="revenue">
      <TabsList className="print:hidden">
        <TabsTrigger value="revenue">Posted revenue ({revenueLines.length})</TabsTrigger>
        <TabsTrigger value="payments">Collected payments ({folioLines.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="revenue" className="print:block">
        <h3 className="hidden print:block text-sm font-bold mb-2">Posted Revenue ({revenueLines.length})</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Txn Code</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Therapist</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Posted by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revenueLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-sm font-medium text-muted-foreground">No revenue posted in this shift.</TableCell>
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
                    <TableCell className="text-xs text-muted-foreground">{l.transactionCode ?? '—'}</TableCell>
                    <TableCell>{l.guestName ?? '—'}</TableCell>
                    <TableCell>{l.serviceName ?? '—'}</TableCell>
                    <TableCell>{l.therapistName ?? '—'}</TableCell>
                    <TableCell className="font-medium">{l.category}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.postedBy ?? '—'}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{peso(l.amountCents)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="payments" className="print:block">
        <h3 className="hidden print:block text-sm font-bold mb-2 mt-4">Collected Payments ({folioLines.length})</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Txn Code</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Posted by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folioLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm font-medium text-muted-foreground">No payments collected in this shift.</TableCell>
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
                    <TableCell className="text-xs text-muted-foreground">{l.transactionCode ?? '—'}</TableCell>
                    <TableCell className="font-medium">{l.method ?? '—'}{l.kind === 'refund' ? <span className="ml-1 text-[10px] font-bold uppercase text-destructive">refund</span> : null}</TableCell>
                    <TableCell className="text-muted-foreground">{l.ref ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.postedBy ?? '—'}</TableCell>
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
