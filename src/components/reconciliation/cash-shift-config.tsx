'use client';

import { useState, useTransition } from 'react';
import { Settings2 } from 'lucide-react';
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

import { setCashShifts, setCashShiftWindows } from '@/app/(dashboard)/reconciliation/cash/actions';

const OPTIONS = ['AM', 'PM', 'Night', 'FullDay'];
type Scope = 'all' | 'branch';

export function CashShiftConfig({ branchId, current, currentCuts }: { branchId: string; current: string[]; currentCuts: [string, string] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(current);
  const [scope, setScope] = useState<Scope>('all');
  const [amPm, setAmPm] = useState(currentCuts[0]);
  const [pmNight, setPmNight] = useState(currentCuts[1]);
  const [pending, startTransition] = useTransition();

  // Window cut points only matter for the AM/PM/Night split, not a single FullDay.
  const splitShifts = !sel.includes('FullDay');

  function toggle(s: string) {
    setSel((prev) => {
      // FullDay is exclusive of the AM/PM/Night set.
      if (s === 'FullDay') return prev.includes('FullDay') ? [] : ['FullDay'];
      const without = prev.filter((x) => x !== 'FullDay');
      return without.includes(s) ? without.filter((x) => x !== s) : [...without, s];
    });
  }

  function save() {
    startTransition(async () => {
      const target = scope === 'all' ? null : branchId;
      const r = await setCashShifts({ shifts: sel, branchId: target });
      if (!r.ok) { toast.error(r.error); return; }
      if (splitShifts) {
        const rw = await setCashShiftWindows({ am_pm_cut: amPm, pm_night_cut: pmNight, branchId: target });
        if (!rw.ok) { toast.error(rw.error); return; }
      }
      toast.success(scope === 'all' ? 'Default shifts updated for all branches' : 'Branch override saved');
      setOpen(false);
    });
  }

  const scopeBtn = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${active ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'bg-muted text-muted-foreground hover:bg-accent'}`;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setSel(current); setScope('all'); setAmPm(currentCuts[0]); setPmNight(currentCuts[1]); setOpen(true); }}>
        <Settings2 className="size-4" /> Shifts
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Cash shifts</DialogTitle>
            <DialogDescription className="font-medium">Pick which shifts get counted each day.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setScope('all')} className={scopeBtn(scope === 'all')}>All branches</button>
              <button type="button" onClick={() => setScope('branch')} className={scopeBtn(scope === 'branch')}>This branch only</button>
            </div>
            <p className="text-[11px] font-medium text-muted-foreground">
              {scope === 'all'
                ? 'Sets the default for every branch that has no override of its own.'
                : 'Overrides just this branch; other branches keep the default.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {OPTIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${sel.includes(o) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                >
                  {o}
                </button>
              ))}
            </div>

            {splitShifts && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <Label className="text-xs font-semibold">Shift times</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-20 font-medium text-muted-foreground">AM → PM</span>
                  <Input type="time" value={amPm} onChange={(e) => setAmPm(e.target.value)} className="w-32" />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-20 font-medium text-muted-foreground">PM → Night</span>
                  <Input type="time" value={pmNight} onChange={(e) => setPmNight(e.target.value)} className="w-32" />
                </div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  AM starts 00:00, Night ends 24:00. The cut points decide which shift a payment falls into.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={save} disabled={pending || sel.length === 0}>{pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
