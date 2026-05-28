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

const HANDLING = [
  { value: 'full_charge', label: 'Full charge' },
  { value: 'partial_charge', label: 'Partial charge (prorate by time)' },
  { value: 'no_charge', label: 'No charge' },
  { value: 'reschedule', label: 'Reschedule (no charge)' },
];

interface Props {
  orderId: string;
  itemId: string;
  serviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InterruptDialog({ orderId, itemId, serviceName, open, onOpenChange }: Props) {
  const [reason, setReason] = useState('');
  const [handling, setHandling] = useState('full_charge');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (reason.trim().length < 3) return toast.error('A reason is required');
    startTransition(async () => {
      const r = await interruptOrderItem({ item_id: itemId, order_id: orderId, reason, handling });
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
            <Select items={HANDLING} value={handling} onValueChange={(v) => v && setHandling(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HANDLING.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Required" />
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
