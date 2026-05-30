'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { interruptOrderItem } from '@/app/(dashboard)/sales-orders/actions';
import {
  INTERRUPT_HANDLINGS,
  INTERRUPT_REASONS_BY_HANDLING,
  INTERRUPT_REASON_OTHER,
  type InterruptHandling,
} from '@/lib/interrupt-taxonomy';

interface Props {
  orderId: string;
  itemId: string;
  serviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InterruptDialog({ orderId, itemId, serviceName, open, onOpenChange }: Props) {
  const [handling, setHandling] = useState<InterruptHandling>('full_charge');
  const [reasonCode, setReasonCode] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Reasons depend on handling — each billing mode has its own short list so
  // staff aren't picking from a 12-line salad. Picking a new handling resets
  // reasonCode so a stale value from a different mode can't get submitted.
  const reasons = INTERRUPT_REASONS_BY_HANDLING[handling];
  const requireNotes = reasonCode === INTERRUPT_REASON_OTHER;

  function submit() {
    if (!reasonCode) return toast.error('Pick a reason');
    if (requireNotes && notes.trim().length < 3) return toast.error('Notes required when reason is Other');
    startTransition(async () => {
      const r = await interruptOrderItem({
        item_id: itemId,
        order_id: orderId,
        handling,
        reason_code: reasonCode,
        notes: notes.trim() || null,
      });
      if (r.ok) { toast.success('Service interrupted'); onOpenChange(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-bold">Interrupt service</DialogTitle>
          <DialogDescription className="font-medium">{serviceName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-3">
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Handling</Label>
            <Select
              items={INTERRUPT_HANDLINGS}
              value={handling}
              onValueChange={(v) => {
                if (!v) return;
                setHandling(v as InterruptHandling);
                setReasonCode('');
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERRUPT_HANDLINGS.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Reason</Label>
            <Select
              items={reasons}
              value={reasonCode}
              onValueChange={(v) => v && setReasonCode(v)}
            >
              <SelectTrigger><SelectValue placeholder="Pick a reason" /></SelectTrigger>
              <SelectContent>
                {reasons.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">
              Notes{requireNotes && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={requireNotes ? 'Required — describe the reason' : 'Optional additional detail'}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={pending}>{pending ? 'Working…' : 'Interrupt'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
