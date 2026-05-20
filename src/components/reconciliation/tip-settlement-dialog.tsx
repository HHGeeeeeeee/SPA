'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { createTipSettlement } from '@/app/(dashboard)/reconciliation/tips/actions';

function halfMonthDefault(): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-');
  const y = Number(parts[0]); const m = Number(parts[1]); const d = Number(parts[2]);
  const mm = String(m).padStart(2, '0');
  if (d <= 15) return { from: `${y}-${mm}-01`, to: `${y}-${mm}-15` };
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${y}-${mm}-16`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export function TipSettlementDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const def = halfMonthDefault();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createTipSettlement({ period_from: from, period_to: to });
      if (r.ok) { toast.success('Draft settlement created'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">New Tip Settlement</DialogTitle>
            <DialogDescription className="font-medium">
              Gathers open PAYMAYA tips in the range for settlement to AP.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ts-from" className="font-semibold">From *</Label>
              <Input id="ts-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ts-to" className="font-semibold">To *</Label>
              <Input id="ts-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
            </div>
            <p className="col-span-2 text-xs font-medium text-muted-foreground">
              Confirming closes the tips (AP posting wired in the ERP phase).
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create draft'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
