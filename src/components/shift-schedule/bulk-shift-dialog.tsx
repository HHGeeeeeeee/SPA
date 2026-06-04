'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { bulkSetShifts } from '@/app/(dashboard)/calendar/actions';

interface Emp { id: string; name: string; code: string; visiting?: boolean }
interface Day { date: string; label: string; dow: string }

const SHIFT_TYPES = [
  { value: 'regular', label: 'Regular' },
  { value: 'cross_branch', label: 'Cross-branch' },
  { value: 'on_call', label: 'On-call' },
  { value: 'off', label: 'Off' },
  { value: 'leave', label: 'Leave' },
];
const LEAVE_TYPES = [
  { value: 'sick', label: 'Sick' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'personal', label: 'Personal' },
  { value: 'unpaid', label: 'Unpaid' },
];
const TIMED = ['regular', 'cross_branch', 'on_call'];

export function BulkShiftDialog({ branchId, employees, days }: { branchId: string; employees: Emp[]; days: Day[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [emps, setEmps] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState<Set<string>>(new Set(days.map((d) => d.date)));
  const [type, setType] = useState('regular');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('18:00');
  const [leaveType, setLeaveType] = useState('sick');

  const timed = TIMED.includes(type);
  const allEmps = employees.length > 0 && emps.size === employees.length;
  const toggleEmp = (id: string) => setEmps((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleDate = (id: string) => setDates((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function submit() {
    if (emps.size === 0) return toast.error('Pick at least one employee');
    if (dates.size === 0) return toast.error('Pick at least one day');
    start(async () => {
      const r = await bulkSetShifts({
        branch_id: branchId,
        employee_ids: [...emps],
        dates: [...dates],
        shift_type: type,
        shift_start: timed ? shiftStart : null,
        shift_end: timed ? shiftEnd : null,
        leave_type: type === 'leave' ? leaveType : null,
      });
      if (r.ok) { toast.success(`Applied to ${r.count} cell${r.count === 1 ? '' : 's'}`); setOpen(false); setEmps(new Set()); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm"><CalendarPlus className="size-4" /> Bulk apply</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-bold">Bulk apply shifts</DialogTitle>
          <DialogDescription className="font-medium">Set one shift for many staff × days at once — replaces those cells.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="font-semibold">Employees</Label>
              <button type="button" className="text-xs font-bold text-primary hover:underline" onClick={() => setEmps(allEmps ? new Set() : new Set(employees.map((e) => e.id)))}>
                {allEmps ? 'Clear' : 'Select all'}
              </button>
            </div>
            <div className="max-h-44 overflow-auto rounded-lg border border-input p-2 flex flex-col gap-0.5">
              {employees.length === 0 ? (
                <p className="text-xs font-medium text-muted-foreground px-1.5 py-1">No therapists for this branch.</p>
              ) : employees.map((e) => (
                <label key={e.id} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-accent">
                  <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={emps.has(e.id)} onChange={() => toggleEmp(e.id)} />
                  <span className="text-sm font-semibold">{e.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{e.code}</span>
                  {e.visiting && <span className="ml-auto text-[10px] font-bold text-amber-600 dark:text-amber-400">visiting</span>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="font-semibold">Days (this week)</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {days.map((d) => {
                const on = dates.has(d.date);
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => toggleDate(d.date)}
                    className={cn('rounded-md border px-2 py-1 text-xs', on ? 'border-primary bg-primary/15 font-bold' : 'border-input font-semibold hover:bg-accent')}
                  >
                    {d.dow}<span className="ml-1 text-muted-foreground tabular-nums">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="font-semibold">Shift type</Label>
              <Select items={SHIFT_TYPES} value={type} onValueChange={(v) => v && setType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SHIFT_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {timed ? (
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1 flex-1"><Label className="text-xs font-semibold">Start</Label><Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} /></div>
                <div className="flex flex-col gap-1 flex-1"><Label className="text-xs font-semibold">End</Label><Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} /></div>
              </div>
            ) : type === 'leave' ? (
              <div className="flex flex-col gap-1">
                <Label className="font-semibold">Leave type</Label>
                <Select items={LEAVE_TYPES} value={leaveType} onValueChange={(v) => v && setLeaveType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAVE_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : <div />}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending || emps.size === 0 || dates.size === 0}>
            {pending ? 'Applying…' : `Apply (${emps.size}×${dates.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
