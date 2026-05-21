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

import { setShift, clearShift } from '@/app/(dashboard)/shift-schedule/actions';

export interface ShiftData {
  shift_type: string;
  shift_start: string | null;
  shift_end: string | null;
  leave_type: string | null;
}

interface Props {
  employeeId: string;
  employeeName: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  shift: ShiftData | null;
}

const TYPES = [
  { value: 'regular', label: 'Regular' },
  { value: 'cross_branch', label: 'Cross-branch' },
  { value: 'on_call', label: 'On-call' },
  { value: 'off', label: 'Day off' },
  { value: 'leave', label: 'Leave' },
];
const LEAVE = [
  { value: 'sick', label: 'Sick' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'personal', label: 'Personal' },
  { value: 'unpaid', label: 'Unpaid' },
];
const TIMED = ['regular', 'cross_branch', 'on_call'];

function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

const TYPE_STYLE: Record<string, string> = {
  regular: 'bg-primary/15 text-primary',
  cross_branch: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  on_call: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  off: 'bg-muted text-muted-foreground',
  leave: 'bg-destructive/15 text-destructive',
};

export function ShiftCell({ employeeId, employeeName, branchId, date, shift }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [type, setType] = useState(shift?.shift_type ?? 'regular');
  const [start, setStart] = useState(hhmm(shift?.shift_start ?? null) || '10:00');
  const [end, setEnd] = useState(hhmm(shift?.shift_end ?? null) || '20:00');
  const [leaveType, setLeaveType] = useState(shift?.leave_type ?? 'vacation');

  const isTimed = TIMED.includes(type);

  function save() {
    startTransition(async () => {
      const r = await setShift({
        employee_id: employeeId,
        branch_id: branchId,
        shift_date: date,
        shift_type: type,
        shift_start: isTimed ? start : null,
        shift_end: isTimed ? end : null,
        leave_type: type === 'leave' ? leaveType : null,
      });
      if (r.ok) { toast.success('Shift saved'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  function clear() {
    startTransition(async () => {
      const r = await clearShift(employeeId, branchId, date);
      if (r.ok) { toast.success('Shift cleared'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  const label = shift
    ? (TIMED.includes(shift.shift_type)
        ? `${hhmm(shift.shift_start)}–${hhmm(shift.shift_end)}`
        : shift.shift_type === 'leave'
          ? (shift.leave_type ?? 'leave')
          : shift.shift_type === 'off' ? 'Off' : shift.shift_type)
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full rounded-md px-2 py-1.5 text-xs font-bold transition-colors ${
          shift ? TYPE_STYLE[shift.shift_type] ?? 'bg-muted' : 'text-muted-foreground/40 hover:bg-accent'
        }`}
      >
        {label ?? '+'}
        {shift?.shift_type === 'cross_branch' && <span className="block text-[10px] font-semibold opacity-80">cross</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Shift · {employeeName}</DialogTitle>
            <DialogDescription className="font-medium tabular">{date}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3">
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Type</Label>
              <Select items={TYPES} value={type} onValueChange={(v) => v && setType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isTimed && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sh-start" className="font-semibold">Start</Label>
                  <Input id="sh-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sh-end" className="font-semibold">End</Label>
                  <Input id="sh-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>
            )}
            {type === 'leave' && (
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Leave Type</Label>
                <Select items={LEAVE} value={leaveType} onValueChange={(v) => v && setLeaveType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAVE.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            {shift && (
              <Button type="button" variant="ghost" className="text-destructive mr-auto" onClick={clear} disabled={pending}>
                Clear
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
