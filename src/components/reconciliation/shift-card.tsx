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

import {
  openShift,
  closeShift,
  reopenShift,
  type ShiftRemittance,
} from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

interface Props {
  branchId: string;
  date: string;
  item: ShiftRemittance;
  canReopen?: boolean;
}

export function ShiftCard({ branchId, date, item, canReopen }: Props) {
  const { shift } = item;
  const [actual, setActual] = useState(shift?.closingCountCents != null ? String(shift.closingCountCents / 100) : '');
  const [reason, setReason] = useState(shift?.varianceReason ?? '');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function doOpen() {
    startTransition(async () => {
      const r = await openShift({ branch_id: branchId, date, label: item.label });
      if (r.ok) { toast.success(`${item.label} opened`); router.refresh(); } else toast.error(r.error);
    });
  }
  function doClose() {
    if (!shift) return;
    startTransition(async () => {
      const r = await closeShift({ shift_id: shift.id, actual_count: Number(actual || 0), variance_reason: reason || null });
      if (r.ok) { toast.success(`${item.label} closed`); router.refresh(); } else toast.error(r.error);
    });
  }
  function doReopen() {
    if (!shift) return;
    startTransition(async () => {
      const r = await reopenShift({ shift_id: shift.id, reason: reopenReason });
      if (r.ok) { toast.success(`${item.label} reopened`); setReopenOpen(false); setReopenReason(''); router.refresh(); } else toast.error(r.error);
    });
  }

  const title = (
    <span className="font-bold">
      {item.label}
      <span className="ml-2 text-xs font-medium text-muted-foreground tabular">{item.windowLabel}</span>
    </span>
  );

  // Money rows shared by the open + closed views. Folio totals are 0 until the
  // posting paths land — the structure is ready for them.
  const totals = (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground">Revenue posted</span>
        <span className="font-bold tabular">{peso(item.revenueCents)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground">Cash payments</span>
        <span className="font-bold tabular">{peso(item.cashCents)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground">Card / other</span>
        <span className="font-bold tabular">{peso(item.nonCashCents)}</span>
      </div>
      {!item.firstOfDay && (
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground">Opening float (handover)</span>
          <span className="font-bold tabular">{peso(shift?.openingFloatCents ?? 0)}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border pt-1">
        <span className="font-medium text-muted-foreground">Expected cash in drawer</span>
        <span className="font-bold tabular">{peso(item.expectedCashCents)}</span>
      </div>
    </div>
  );

  // ── Not opened yet ──────────────────────────────────────────────────────
  if (!shift) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          {title}
          <Badge variant="secondary" className="font-bold">Not opened</Badge>
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          Open this shift before any sale or payment can post into it.
        </p>
        <Button size="sm" onClick={doOpen} disabled={pending} className="self-start">
          {pending ? 'Opening…' : 'Open shift'}
        </Button>
      </div>
    );
  }

  // ── Closed ──────────────────────────────────────────────────────────────
  if (shift.status === 'closed') {
    return (
      <div className="rounded-lg border border-border p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {title}
          <Badge className="font-bold">Closed</Badge>
        </div>
        {totals}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Counted</span>
          <span className="font-bold tabular">{peso(shift.closingCountCents ?? 0)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Variance</span>
          <span className={`font-bold tabular ${(shift.varianceCents ?? 0) === 0 ? 'text-primary' : 'text-destructive'}`}>{peso(shift.varianceCents ?? 0)}</span>
        </div>
        {shift.varianceReason && <p className="text-xs font-medium text-muted-foreground">Reason: {shift.varianceReason}</p>}
        {canReopen && (
          <Button size="sm" variant="outline" className="self-start mt-1" onClick={() => setReopenOpen(true)} disabled={pending}>
            Reopen
          </Button>
        )}

        <AlertDialog open={reopenOpen} onOpenChange={setReopenOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reopen {item.label}?</AlertDialogTitle>
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
    );
  }

  // ── Open ────────────────────────────────────────────────────────────────
  const actualCents = Math.round(Number(actual || 0) * 100);
  const variance = actualCents - item.expectedCashCents;
  return (
    <div className="rounded-lg border border-primary/40 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {title}
        <Badge variant="outline" className="font-bold border-primary/50 text-primary">Open</Badge>
      </div>
      {totals}
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
      <Button size="sm" onClick={doClose} disabled={pending || actual === ''} className="self-start">
        {pending ? 'Closing…' : `Count & close ${item.label}`}
      </Button>
    </div>
  );
}
