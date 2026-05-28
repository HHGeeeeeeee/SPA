'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Settings2, Plus, Trash2 } from 'lucide-react';
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

import { setCashShiftConfig } from '@/app/(dashboard)/reconciliation/cash/actions';
import { DAY_END, hhmmToMin, minToHHMM, type CashShiftConfig } from '@/app/(dashboard)/reconciliation/cash/shifts';

type Scope = 'all' | 'branch';
interface Row { name: string; end: string } // end is HH:MM; the last row always ends at midnight

function toRows(cfg: CashShiftConfig): { open: string; rows: Row[] } {
  return {
    open: minToHHMM(cfg.open),
    rows: cfg.shifts.map((s) => ({ name: s.name, end: minToHHMM(s.end) })),
  };
}

export function CashShiftConfig({ branchId, config }: { branchId: string; config: CashShiftConfig }) {
  const initial = toRows(config);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [dayOpen, setDayOpen] = useState(initial.open);
  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    const r = toRows(config);
    setScope('all');
    setDayOpen(r.open);
    setRows(r.rows);
  }

  // Each row starts where the previous ended (continuous). The last row always
  // ends at midnight (24:00); only interior boundaries are editable.
  const startOf = (i: number) => (i === 0 ? dayOpen : rows[i - 1].end);

  const setName = (i: number, name: string) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, name } : r)));
  const setEnd = (i: number, end: string) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, end } : r)));

  function addShift() {
    setRows((p) => {
      const prevLastStart = hhmmToMin(p.length <= 1 ? dayOpen : p[p.length - 2].end) ?? 0;
      const boundary = Math.min(DAY_END - 60, prevLastStart + 180);
      const updated = [...p];
      updated[updated.length - 1] = { ...updated[updated.length - 1], end: minToHHMM(boundary) };
      updated.push({ name: `Shift ${updated.length + 1}`, end: minToHHMM(DAY_END) });
      return updated;
    });
  }
  function removeShift(i: number) {
    setRows((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)));
  }

  // Validate: names present + unique; boundaries strictly increasing open→…→24:00.
  const names = rows.map((r) => r.name.trim());
  const emptyName = names.some((n) => n.length === 0);
  const dupName = new Set(names.map((n) => n.toLowerCase())).size !== names.length;
  const bounds: (number | null)[] = [hhmmToMin(dayOpen), ...rows.slice(0, -1).map((r) => hhmmToMin(r.end)), DAY_END];
  const boundsOk = bounds.every((b, i) => b != null && (i === 0 || ((bounds[i - 1] as number) < (b as number))));
  const valid = rows.length >= 1 && !emptyName && !dupName && boundsOk;
  const errorMsg = emptyName
    ? 'Every shift needs a name.'
    : dupName
      ? 'Shift names must be unique.'
      : !boundsOk
        ? 'Times must run in order: open is before each shift end, ending at midnight.'
        : null;

  function save() {
    if (!valid) return;
    const target = scope === 'all' ? null : branchId;
    const shifts = rows.map((r, i) => ({ name: r.name.trim(), end: i === rows.length - 1 ? DAY_END : (hhmmToMin(r.end) ?? 0) }));
    startTransition(async () => {
      const res = await setCashShiftConfig({ open: hhmmToMin(dayOpen) ?? 0, shifts, branchId: target });
      if (res.ok) { toast.success(scope === 'all' ? 'Default shifts updated for all branches' : 'Branch override saved'); setOpen(false); router.refresh(); }
      else toast.error(res.error);
    });
  }

  const scopeBtn = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${active ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'bg-muted text-muted-foreground hover:bg-accent'}`;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { reset(); setOpen(true); }}>
        <Settings2 className="size-4" /> Shifts
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-bold">Cash shifts</DialogTitle>
            <DialogDescription className="font-medium">
              Define the drawer-count shifts for each day. They run back-to-back from open to midnight.
            </DialogDescription>
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

            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold w-20">Opens at</Label>
              <Input type="time" value={dayOpen} onChange={(e) => setDayOpen(e.target.value)} className="w-36" />
            </div>

            <div className="flex flex-col gap-1.5">
              {rows.map((r, i) => {
                const isLast = i === rows.length - 1;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={r.name}
                      onChange={(e) => setName(i, e.target.value)}
                      placeholder={`Shift ${i + 1}`}
                      className="w-32"
                    />
                    <span className="w-14 text-center text-xs font-semibold text-muted-foreground tabular">{startOf(i)}</span>
                    <span className="text-muted-foreground">→</span>
                    {isLast ? (
                      <span className="w-36 text-center text-sm font-semibold text-muted-foreground tabular">24:00</span>
                    ) : (
                      <Input type="time" value={r.end} onChange={(e) => setEnd(i, e.target.value)} className="w-36" />
                    )}
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeShift(i)}
                      disabled={rows.length <= 1}
                      title="Remove shift"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <Button type="button" size="sm" variant="outline" className="self-start" onClick={addShift}>
              <Plus className="size-4" /> Add shift
            </Button>

            {errorMsg && (
              <p className="text-[11px] font-bold text-destructive">{errorMsg}</p>
            )}
            <p className="text-[11px] font-medium text-muted-foreground">
              Shifts are continuous — each begins where the previous ends. The last runs to midnight (24:00), so the whole day is covered.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={save} disabled={pending || !valid}>{pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
