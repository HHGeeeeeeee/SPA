'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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

import { closeCashReconciliation, reopenCashReconciliation } from '@/app/(dashboard)/reconciliation/cash/actions';
import { type ShiftStatus } from '@/app/(dashboard)/reconciliation/cash/shifts';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

interface Props {
  branchId: string;
  date: string;
  shift: ShiftStatus;
  canReopen?: boolean;
  /** Other shifts on the same business day, with their cash received. Drives
   *  the cross-shift hint AND the always-render-breakdown decision (we want
   *  the data rows above the input to line up across sibling cards — if any
   *  shift on the day got cash we render the SO/AR breakdown on every card,
   *  including the ones with zero, so Expected/Counted sit at the same Y).
   *  Empty array = no hint, no breakdown. */
  siblings?: { label: string; receivedCents: number }[];
}

export function CashReconForm({ branchId, date, shift, canReopen, siblings = [] }: Props) {
  const [actual, setActual] = useState(shift.closed ? String((shift.closed.actualCents) / 100) : '');
  const [reason, setReason] = useState(shift.closed?.reason ?? '');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reopen() {
    startTransition(async () => {
      const r = await reopenCashReconciliation({ branch_id: branchId, date, shift_label: shift.label, reason: reopenReason });
      if (r.ok) { toast.success(`${shift.label} reopened`); setReopenOpen(false); setReopenReason(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  const actualCents = Math.round(Number(actual || 0) * 100);
  const variance = actualCents - shift.expectedCents;

  function close() {
    startTransition(async () => {
      const r = await closeCashReconciliation({ branch_id: branchId, date, shift_label: shift.label, actual_count: Number(actual || 0), variance_reason: reason || null });
      if (r.ok) { toast.success(`${shift.label} reconciliation closed`); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Show only siblings that actually received cash — a sibling with 0 is just
  // noise. The case we care about is "you took cash but it's not here" (it's
  // in another shift because of the paid_at clock).
  const siblingsWithCash = siblings.filter((s) => s.receivedCents > 0);
  // Cross-shift "any cash today?" — drives whether to render the SO/AR
  // breakdown on every card (so the Expected/Counted lines align), or
  // suppress on quiet days where everything would be zero.
  const anyCashToday = shift.receivedCents > 0 || siblings.some((s) => s.receivedCents > 0);
  // Reservation rules: when there are multiple shifts on the day, AT LEAST one
  // card will render the heads-up chip and the Opening float row. The other
  // card(s) reserve the same vertical slot with a placeholder / muted "—" so
  // Expected/Counted/Variance line up horizontally across cards. Without this
  // the card without those extras floats higher and the rows zig-zag.
  const reserveHeadsUp = anyCashToday && siblings.length > 0;
  const reserveOpeningFloat = siblings.length > 0;

  const rows = (
    <div className="flex flex-col gap-1 text-sm">
      {reserveHeadsUp && (
        // Cross-shift context — payments are attributed by paid_at clock, not
        // by who was on duty, so a 17:01 cash sale by a Shift-1 cashier lands
        // in Shift-2. Without this line, the cashier sees "Cash received = 0"
        // here, counts what's actually in their drawer, and gets a positive
        // variance they can't explain.
        //
        // When this card has no message but a sibling does, render an
        // invisible placeholder of the same shape so the rows below line up.
        siblingsWithCash.length > 0 ? (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-2 py-1 text-xs font-medium text-amber-900 dark:text-amber-200">
            <span className="font-bold">Heads up:</span> other shifts today —{' '}
            {siblingsWithCash.map((s, i) => (
              <span key={s.label}>
                {i > 0 ? ', ' : ''}
                <span className="font-bold">{s.label}</span> ₱{peso(s.receivedCents)}
              </span>
            ))}
            . If the cash is in your drawer it may have been paid after the shift boundary.
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="invisible rounded-md border px-2 py-1 text-xs font-medium"
          >
            <span className="font-bold">Heads up:</span> placeholder — reserves the same vertical
            slot as the chip shown on the sibling card so the rows below align.
          </div>
        )
      )}
      {reserveOpeningFloat ? (
        // Always render the row when more than one shift exists today, so
        // firstOfDay cards reserve the slot with "—" instead of leaving the
        // row missing (which would float Cash received up vs sibling cards).
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground">Opening float (handover)</span>
          {shift.firstOfDay ? (
            <span className="font-medium tabular text-muted-foreground">—</span>
          ) : (
            <span className="font-bold tabular">{peso(shift.openingCents)}</span>
          )}
        </div>
      ) : !shift.firstOfDay && (
        // Single-shift day with handover (shouldn't normally happen — the
        // first shift of a day has no handover by definition — but kept for
        // safety so a misconfigured day still shows the float).
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground">Opening float (handover)</span>
          <span className="font-bold tabular">{peso(shift.openingCents)}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground">Cash received this shift</span>
        <span className="font-bold tabular">{peso(shift.receivedCents)}</span>
      </div>
      {/* Source breakdown — rendered on every card when ANY shift today got
          cash, so the rows below (Expected / Counted) align across sibling
          cards even when this card has zero. Suppressed entirely on quiet
          days where all shifts are zero. The two lines always sum to the
          row above; useful for the cashier to know whether the till delta
          came from counter sales or from collecting an AR settlement. */}
      {anyCashToday && (
        <div className="ml-3 flex flex-col gap-0.5 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>· from Sales Orders (counter)</span>
            <span className="tabular">{peso(shift.counterCashCents)}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>· from AR Settle (SOA payment)</span>
            <span className="tabular">{peso(shift.arSettleCashCents)}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border pt-1">
        <span className="font-medium text-muted-foreground">Expected in drawer</span>
        <span className="font-bold tabular">{peso(shift.expectedCents)}</span>
      </div>
    </div>
  );

  if (shift.closed) {
    return (
      <div className="rounded-lg border border-border p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-bold">{shift.label}<span className="ml-2 text-xs font-medium text-muted-foreground tabular">{shift.windowLabel}</span></span>
          <Badge className="font-bold">Closed</Badge>
        </div>
        {rows}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Counted</span>
          <span className="font-bold tabular">{peso(shift.closed.actualCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Variance</span>
          <span className={`font-bold tabular ${shift.closed.varianceCents === 0 ? 'text-primary' : 'text-destructive'}`}>{peso(shift.closed.varianceCents)}</span>
        </div>
        {shift.closed.reason && <p className="text-xs font-medium text-muted-foreground">Reason: {shift.closed.reason}</p>}
        {canReopen && (
          <Button size="sm" variant="outline" className="self-start mt-1" onClick={() => setReopenOpen(true)} disabled={pending}>
            Reopen
          </Button>
        )}

        <AlertDialog open={reopenOpen} onOpenChange={setReopenOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reopen {shift.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                This unlocks the shift for recounting (e.g. cash came in after closing) and re-locks Revenue Confirm. A reason is required.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2} placeholder="Why is this being reopened?" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={reopen} disabled={pending || reopenReason.trim().length < 3}>Reopen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <span className="font-bold">{shift.label}<span className="ml-2 text-xs font-medium text-muted-foreground tabular">{shift.windowLabel}</span></span>
      {rows}
      <div className="flex flex-col gap-2">
        <Label className="font-semibold">Counted cash</Label>
        <Input type="number" min="0" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} className="w-40" />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">Variance</span>
        <span className={`font-bold tabular ${variance === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>{peso(variance)}</span>
      </div>
      {variance !== 0 && actual !== '' && (
        <div className="flex flex-col gap-2">
          <Label className="font-semibold">Variance reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Required when the count doesn't match" />
        </div>
      )}
      <Button size="sm" onClick={close} disabled={pending || actual === ''} className="self-start">
        {pending ? 'Closing…' : `Close ${shift.label}`}
      </Button>
    </div>
  );
}
