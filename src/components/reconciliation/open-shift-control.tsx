'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { openShift } from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

// Single "Open shift" action: the cashier opens a drawer, then picks which shift
// (AM / PM / GY) it is. We don't pre-list the shifts as empty cards — that made
// staff ask "what if I don't run that shift?" — they just open one and label it.
export function OpenShiftControl({
  branchId,
  date,
  labels,
}: {
  branchId: string;
  date: string;
  labels: string[]; // shift labels not yet opened today
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(labels[0] ?? '');
  const [pending, start] = useTransition();
  const router = useRouter();

  if (labels.length === 0) return null; // every shift already opened today

  function doOpen() {
    if (!label) return toast.error('Pick a shift');
    start(async () => {
      const r = await openShift({ branch_id: branchId, date, label });
      if (r.ok) { toast.success(`${label} opened`); setOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => { setLabel(labels[0] ?? ''); setOpen(true); }}>
        <Plus className="size-4" /> Open shift
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Open a shift</DialogTitle>
            <DialogDescription className="font-medium">
              Pick which shift you&apos;re opening — every sale and payment lands in it until you close it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label className="font-semibold">Shift</Label>
            <Select items={labels.map((l) => ({ value: l, label: l }))} value={label} onValueChange={(v) => v && setLabel(v)}>
              <SelectTrigger><SelectValue placeholder="Pick a shift" /></SelectTrigger>
              <SelectContent>
                {labels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={doOpen} disabled={pending || !label}>
              {pending ? 'Opening…' : 'Open shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
