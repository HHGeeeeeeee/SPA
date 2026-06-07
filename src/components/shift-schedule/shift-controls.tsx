'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronDown, Check, Users, BedDouble, Receipt, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TopBarPortal } from '@/components/layout/topbar-portal';
import { CreateOrderDialog } from '@/components/sales-orders/create-order-dialog';
import type { BoardDialogData } from '@/components/shift-schedule/schedule-board';

type CalendarView = 'station' | 'people';

interface Props {
  branches: { id: string; code: string; name: string }[];
  branchId: string;
  selected: string[]; // branch ids currently shown on the board (multi-select)
  day: string; // YYYY-MM-DD (selected day)
  view: CalendarView;
  // Option lists for the toolbar's "Create Order" dialog (same data the board's
  // click-to-add uses).
  dialog: BoardDialogData;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoUTC = (dt: Date) => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
// UTC date math so a +1/-1 day shift never drifts across a local-midnight / UTC boundary.
function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return isoUTC(new Date(Date.UTC(y, m - 1, d + delta)));
}
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function ShiftControls({ branches, branchId, selected, day, view, dialog }: Props) {
  const router = useRouter();
  const [branchOpen, setBranchOpen] = useState(false);
  const selSet = new Set(selected);
  const branchLabel = selected.length >= branches.length ? 'All branches'
    : selected.length === 1 ? (branches.find((b) => b.id === selected[0])?.code ?? '1 branch')
    : `${branches.find((b) => b.id === selected[0])?.code ?? ''} +${selected.length - 1}`;
  function toggleBranch(id: string) {
    const next = new Set(selSet);
    if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
    go({ branch: branches.filter((b) => next.has(b.id)).map((b) => b.id).join(',') });
  }

  function go(opts: { branch?: string; day?: string; view?: CalendarView }) {
    const branch = opts.branch ?? (selected.join(',') || branchId);
    const v = opts.view ?? view;
    const dy = opts.day ?? day;
    router.push(`/calendar?branch=${branch}&view=${v}&day=${dy}`);
  }

  const tabBtn = (active: boolean) =>
    cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold transition-colors', active ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'text-muted-foreground hover:bg-accent');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Create Order — opens the booking dialog standalone (no pre-picked bed),
          defaulting to the branch currently on the board. Leftmost so it reads as
          the primary action on the calendar. */}
      <CreateOrderDialog
        dialog={dialog}
        initialBranchId={branchId}
        trigger={
          <Button size="sm" className="gap-1.5 font-bold">
            <Plus className="size-4" /> Create Order
          </Button>
        }
      />

      {/* subject axis: Station = the per-bed board, People = the same board
          keyed on therapists (each row a person, shift hours as a faint band). */}
      <div className="inline-flex rounded-lg border border-border p-0.5">
        <button type="button" onClick={() => go({ view: 'station' })} className={tabBtn(view === 'station')}>
          <BedDouble className="size-4" /> Station
        </button>
        <button type="button" onClick={() => go({ view: 'people' })} className={tabBtn(view === 'people')}>
          <Users className="size-4" /> People
        </button>
      </div>

      {/* Sales Order — opens the orders page in a NEW TAB (it's no longer in the
          sidebar; the desk jumps to an order without leaving the board). */}
      <a
        href="/sales-orders"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent"
      >
        <Receipt className="size-4" /> Sales Order
      </a>

      {/* Branch switcher lives in the global top bar (top-right), hoisted there
          via the topbar portal slot. */}
      <TopBarPortal>
        {/* Multi-select branch picker — tick which branches the board shows.
            Defaults to ALL accessible branches; untick to narrow (grouped by
            Branch). At least one stays selected. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setBranchOpen((o) => !o)}
            className="flex w-56 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm font-semibold"
          >
            <span className="truncate">{branchLabel}</span>
            <ChevronDown className="size-4 shrink-0 opacity-60" />
          </button>
          {branchOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBranchOpen(false)} />
              <div className="absolute right-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                {branches.map((b) => {
                  const on = selSet.has(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBranch(b.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="font-semibold">{b.code}</span>
                      <span className="truncate text-muted-foreground">{b.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </TopBarPortal>

      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" onClick={() => go({ day: addDays(day, -1) })}><ChevronLeft className="size-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => go({ day: today() })}>Today</Button>
        <Button size="icon" variant="outline" onClick={() => go({ day: addDays(day, 1) })}><ChevronRight className="size-4" /></Button>
        <input
          type="date"
          value={day}
          onChange={(e) => e.target.value && go({ day: e.target.value })}
          className="ml-1 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}
