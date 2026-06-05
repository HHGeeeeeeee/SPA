'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Users, BedDouble } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TopBarPortal } from '@/components/layout/topbar-portal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type CalendarView = 'station' | 'people';

interface Props {
  branches: { id: string; code: string; name: string }[];
  branchId: string;
  day: string; // YYYY-MM-DD (selected day)
  view: CalendarView;
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

export function ShiftControls({ branches, branchId, day, view }: Props) {
  const router = useRouter();
  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  function go(opts: { branch?: string; day?: string; view?: CalendarView }) {
    const branch = opts.branch ?? branchId;
    const v = opts.view ?? view;
    const dy = opts.day ?? day;
    router.push(`/calendar?branch=${branch}&view=${v}&day=${dy}`);
  }

  const tabBtn = (active: boolean) =>
    cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold transition-colors', active ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'text-muted-foreground hover:bg-accent');

  return (
    <div className="flex flex-wrap items-center gap-2">
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

      {/* Branch switcher lives in the global top bar (top-right), hoisted there
          via the topbar portal slot. */}
      <TopBarPortal>
        <Select items={branchOptions} value={branchId} onValueChange={(v) => v && go({ branch: v })}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
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
