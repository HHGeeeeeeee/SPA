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

import { setBranchShifts } from '@/app/(dashboard)/reconciliation/cash/actions';

const OPTIONS = ['AM', 'PM', 'Night', 'FullDay'];

export function CashShiftConfig({ branchId, current }: { branchId: string; current: string[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(current);
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
      const r = await setBranchShifts(branchId, sel);
      if (r.ok) { toast.success('Shifts updated'); setOpen(false); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setSel(current); setOpen(true); }}>
        <Settings2 className="size-4" /> Shifts
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Cash shifts for this branch</DialogTitle>
            <DialogDescription className="font-medium">Pick which shifts get counted each day.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 py-3">
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={save} disabled={pending || sel.length === 0}>{pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
