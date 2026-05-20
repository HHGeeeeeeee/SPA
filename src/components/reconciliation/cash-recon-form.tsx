'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { closeCashReconciliation } from '@/app/(dashboard)/reconciliation/cash/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

interface Props {
  branchId: string;
  date: string;
  expectedCents: number;
  closed: { actual_received_cents: number | null; variance_cents: number | null; variance_reason: string | null } | null;
}

export function CashReconForm({ branchId, date, expectedCents, closed }: Props) {
  const [actual, setActual] = useState(closed ? String((closed.actual_received_cents ?? 0) / 100) : '');
  const [reason, setReason] = useState(closed?.variance_reason ?? '');
  const [pending, startTransition] = useTransition();

  const actualCents = Math.round(Number(actual || 0) * 100);
  const variance = actualCents - expectedCents;

  function close() {
    startTransition(async () => {
      const r = await closeCashReconciliation({ branch_id: branchId, date, actual_count: Number(actual || 0), variance_reason: reason || null });
      if (r.ok) toast.success('Cash reconciliation closed');
      else toast.error(r.error);
    });
  }

  if (closed) {
    return (
      <div className="rounded-lg border border-border p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">System expected</span>
          <span className="font-bold tabular">{peso(expectedCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Counted</span>
          <span className="font-bold tabular">{peso(closed.actual_received_cents ?? 0)}</span>
        </div>
        <div className="flex items-center justify-between text-sm border-t border-border pt-2">
          <span className="font-medium text-muted-foreground">Variance</span>
          <span className={`font-bold tabular ${(closed.variance_cents ?? 0) === 0 ? 'text-primary' : 'text-destructive'}`}>
            {peso(closed.variance_cents ?? 0)}
          </span>
        </div>
        {closed.variance_reason && (
          <p className="text-xs font-medium text-muted-foreground">Reason: {closed.variance_reason}</p>
        )}
        <p className="text-xs font-bold uppercase tracking-wide text-primary mt-1">Closed — Revenue Confirm unlocked</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">System expected (cash)</span>
        <span className="font-bold tabular">{peso(expectedCents)}</span>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="count" className="font-semibold">Counted cash (₱)</Label>
        <Input id="count" type="number" min="0" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} className="w-40" />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">Variance</span>
        <span className={`font-bold tabular ${variance === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>{peso(variance)}</span>
      </div>
      {variance !== 0 && actual !== '' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="vr" className="font-semibold">Variance reason</Label>
          <Textarea id="vr" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Required when the count doesn't match" />
        </div>
      )}
      <Button size="sm" onClick={close} disabled={pending || actual === ''} className="self-start">
        {pending ? 'Closing…' : 'Close reconciliation'}
      </Button>
    </div>
  );
}
