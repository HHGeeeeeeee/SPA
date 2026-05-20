'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

import { closeCashReconciliation } from '@/app/(dashboard)/reconciliation/cash/actions';
import { type ShiftStatus } from '@/app/(dashboard)/reconciliation/cash/shifts';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

interface Props {
  branchId: string;
  date: string;
  shift: ShiftStatus;
}

export function CashReconForm({ branchId, date, shift }: Props) {
  const [actual, setActual] = useState(shift.closed ? String((shift.closed.actualCents) / 100) : '');
  const [reason, setReason] = useState(shift.closed?.reason ?? '');
  const [pending, startTransition] = useTransition();

  const actualCents = Math.round(Number(actual || 0) * 100);
  const variance = actualCents - shift.expectedCents;

  function close() {
    startTransition(async () => {
      const r = await closeCashReconciliation({ branch_id: branchId, date, shift_label: shift.label, actual_count: Number(actual || 0), variance_reason: reason || null });
      if (r.ok) toast.success(`${shift.label} reconciliation closed`);
      else toast.error(r.error);
    });
  }

  const rows = (
    <div className="flex flex-col gap-1 text-sm">
      {shift.label !== 'FullDay' && (
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
          <span className="font-bold">{shift.label}</span>
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
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <span className="font-bold">{shift.label}</span>
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
