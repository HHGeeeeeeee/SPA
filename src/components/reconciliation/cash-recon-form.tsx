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
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

interface Props {
  branchId: string;
  date: string;
  shift: ShiftStatus;
  canReopen?: boolean;
}

export function CashReconForm({ branchId, date, shift, canReopen }: Props) {
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

  const rows = (
    <div className="flex flex-col gap-1 text-sm">
      {!shift.firstOfDay && (
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground">Opening float (handover)</span>
          <span className="font-bold tabular">{peso(shift.openingCents)}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground">Cash received this shift</span>
        <span className="font-bold tabular">{peso(shift.receivedCents)}</span>
      </div>
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
        <Label className="font-semibold">Counted cash (₱)</Label>
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
