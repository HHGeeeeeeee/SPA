'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { closeShift, reopenShift, type ShiftMethodRow } from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

function peso(c: number | null): string {
  return ((c ?? 0) / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

interface Props {
  shiftId: string;
  label: string;
  status: 'open' | 'closed';
  methodRows: ShiftMethodRow[];
  cashExpectedCents: number;
  closingCountCents: number | null;
  varianceCents: number | null;
  varianceReason: string | null;
  canReopen: boolean;
  revenueByCategory: { name: string; cents: number }[];
  revenueTotalCents: number;
  paymentsExpectedTotalCents: number;
  openingFloatCents: number;
  firstOfDay: boolean;
}

// The whole Remittance block: a per-method table where the cash row's Declared
// cell IS the count input (open) and Over/Short updates live, plus the revenue +
// cash-drawer summary and the close / reopen action — no separate count field.
export function ShiftRemittancePanel({
  shiftId, label, status, methodRows, cashExpectedCents, closingCountCents, varianceCents, varianceReason,
  canReopen, revenueByCategory, revenueTotalCents, paymentsExpectedTotalCents, openingFloatCents, firstOfDay,
}: Props) {
  const router = useRouter();
  const open = status === 'open';
  const [actual, setActual] = useState(closingCountCents != null ? String(closingCountCents / 100) : '');
  const [reason, setReason] = useState(varianceReason ?? '');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [pending, start] = useTransition();

  const actualCents = actual === '' ? null : Math.round(Number(actual) * 100);
  // Cash is counted (live when open, stored when closed); other methods balance
  // automatically (declared = expected, over/short = 0).
  const declaredOf = (r: ShiftMethodRow): number | null =>
    !r.countable ? r.expectedCents : open ? actualCents : (closingCountCents ?? 0);
  const overShortOf = (r: ShiftMethodRow): number | null =>
    !r.countable ? 0 : open ? (actualCents == null ? null : actualCents - cashExpectedCents) : (varianceCents ?? 0);
  const declared = methodRows.map(declaredOf);
  const overShort = methodRows.map(overShortOf);
  const expectedTotal = methodRows.reduce((s, r) => s + r.expectedCents, 0);
  const declaredTotal = declared.every((v) => v != null) ? declared.reduce((s, v) => s + (v ?? 0), 0) : null;
  const overShortTotal = overShort.every((v) => v != null) ? overShort.reduce((s, v) => s + (v ?? 0), 0) : null;
  const liveVariance = actualCents == null ? null : actualCents - cashExpectedCents;

  function doClose() {
    start(async () => {
      const r = await closeShift({ shift_id: shiftId, actual_count: Number(actual || 0), variance_reason: reason || null });
      if (r.ok) { toast.success(`${label} closed`); router.refresh(); } else toast.error(r.error);
    });
  }
  function doReopen() {
    start(async () => {
      const r = await reopenShift({ shift_id: shiftId, reason: reopenReason });
      if (r.ok) { toast.success(`${label} reopened`); setReopenOpen(false); setReopenReason(''); router.refresh(); } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment method</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Declared</TableHead>
              <TableHead className="text-right">Over / Short</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {methodRows.map((r, i) => (
              <TableRow key={r.code}>
                <TableCell className="font-semibold">{r.method}{r.countable ? <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">counted</span> : null}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{peso(r.expectedCents)}</TableCell>
                <TableCell className="text-right">
                  {r.countable && open
                    ? <Input type="number" min="0" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} className="ml-auto h-8 w-32 text-right" placeholder="Count…" />
                    : <span className="font-semibold tabular-nums">{declared[i] == null ? '—' : peso(declared[i])}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {overShort[i] == null
                    ? <span className="text-muted-foreground">—</span>
                    : <span className={`font-bold tabular-nums ${overShort[i] === 0 ? 'text-primary' : 'text-destructive'}`}>{peso(overShort[i])}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Overall totals</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{peso(expectedTotal)}</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{declaredTotal == null ? '—' : peso(declaredTotal)}</TableCell>
              <TableCell className="text-right font-bold tabular-nums">{overShortTotal == null ? '—' : peso(overShortTotal)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Revenue posted</div>
          {revenueByCategory.length === 0 ? (
            <p className="font-medium text-muted-foreground">No revenue posted yet.</p>
          ) : (
            revenueByCategory.map((r) => (
              <div key={r.name} className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground">{r.name}</span>
                <span className="font-semibold tabular-nums">{peso(r.cents)}</span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between border-t border-border pt-1.5">
            <span className="font-semibold">Total revenue</span>
            <span className="font-bold tabular-nums">{peso(revenueTotalCents)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Cash drawer</div>
          <div className="flex items-center justify-between"><span className="font-medium text-muted-foreground">Payments collected</span><span className="font-semibold tabular-nums">{peso(paymentsExpectedTotalCents)}</span></div>
          {!firstOfDay && (
            <div className="flex items-center justify-between"><span className="font-medium text-muted-foreground">Opening float (handover)</span><span className="font-semibold tabular-nums">{peso(openingFloatCents)}</span></div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-1.5"><span className="font-semibold">Expected cash in drawer</span><span className="font-bold tabular-nums">{peso(cashExpectedCents)}</span></div>
        </div>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {liveVariance !== null && liveVariance !== 0 && (
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Variance reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Required when the count doesn't match" />
            </div>
          )}
          <Button onClick={doClose} disabled={pending || actual === ''} className="self-start">
            {pending ? 'Closing…' : `Count & close ${label}`}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {varianceReason && <p className="text-xs font-medium text-muted-foreground">Variance reason: {varianceReason}</p>}
          {canReopen && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => setReopenOpen(true)} disabled={pending}>Reopen</Button>
          )}
          <AlertDialog open={reopenOpen} onOpenChange={setReopenOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reopen {label}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Unlocks the shift so postings can land in it again (e.g. cash came in after closing). A reason is required.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2} placeholder="Why is this being reopened?" />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={doReopen} disabled={pending || reopenReason.trim().length < 3}>Reopen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
