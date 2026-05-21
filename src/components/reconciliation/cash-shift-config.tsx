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

import { setCashShifts } from '@/app/(dashboard)/reconciliation/cash/actions';

const OPTIONS = ['AM', 'PM', 'Night', 'FullDay'];
type Scope = 'all' | 'branch';

export function CashShiftConfig({ branchId, current }: { branchId: string; current: string[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(current);
  const [scope, setScope] = useState<Scope>('all');
  const [pending, startTransition] = useTransition();

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
      const r = await setCashShifts({ shifts: sel, branchId: scope === 'all' ? null : branchId });
      if (r.ok) { toast.success(scope === 'all' ? 'Default shifts updated for all branches' : 'Branch override saved'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  const scopeBtn = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${active ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'bg-muted text-muted-foreground hover:bg-accent'}`;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setSel(current); setScope('all'); setOpen(true); }}>
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
