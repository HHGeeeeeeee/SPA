'use client';

import { useState, useTransition } from 'react';
import { UserPlus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { setShift } from '@/app/(dashboard)/shift-schedule/actions';

export interface DispatchableEmployee {
  id: string;
  name: string;
  employee_code: string;
  homeBranchCode: string | null;
}

interface DayOption {
  date: string;
  label: string;
  dow: string;
}

interface Props {
  branchId: string;
  days: DayOption[];
  dispatchable: DispatchableEmployee[];
}

export function DispatchTherapist({ branchId, days, dispatchable }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [employeeId, setEmployeeId] = useState('');
  const [day, setDay] = useState(days[0]?.date ?? '');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('20:00');

  const empOptions = dispatchable.map((e) => ({
    value: e.id,
    label: `${e.name} · ${e.employee_code}${e.homeBranchCode ? ` (from ${e.homeBranchCode})` : ''}`,
  }));
  const dayOptions = days.map((d) => ({ value: d.date, label: `${d.dow} ${d.label}` }));

  function openDialog() {
    setEmployeeId(dispatchable[0]?.id ?? '');
    setDay(days[0]?.date ?? '');
    setStart('10:00');
    setEnd('20:00');
    setOpen(true);
  }

  function save() {
    if (!employeeId) { toast.error('Pick a therapist'); return; }
    startTransition(async () => {
      const r = await setShift({
        employee_id: employeeId,
        branch_id: branchId,
        shift_date: day,
        shift_type: 'cross_branch',
        shift_start: start,
        shift_end: end,
      });
      if (r.ok) { toast.success('Therapist dispatched'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={openDialog} disabled={dispatchable.length === 0}>
        <UserPlus className="size-4" /> Dispatch therapist
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Dispatch a therapist</DialogTitle>
            <DialogDescription className="font-medium">
              Roster a therapist from another branch here as a cross-branch shift. They will then appear in this schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3">
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Therapist</Label>
              <Select items={empOptions} value={employeeId} onValueChange={(v) => v && setEmployeeId(v)}>
                <SelectTrigger><SelectValue placeholder="Pick a therapist" /></SelectTrigger>
                <SelectContent>
                  {empOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Day</Label>
              <Select items={dayOptions} value={day} onValueChange={(v) => v && setDay(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dayOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="d-start" className="font-semibold">Start</Label>
                <Input id="d-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="d-end" className="font-semibold">End</Label>
                <Input id="d-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              This sets one day. Once dispatched, fill the rest of the week by clicking their row cells.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Dispatch'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
