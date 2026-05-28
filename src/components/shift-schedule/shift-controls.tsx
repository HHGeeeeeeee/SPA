'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Users, BedDouble, CalendarDays, Clock, Hotel } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ShiftView = 'employee' | 'station' | 'dispatch';
type ShiftScale = 'week' | 'day';

interface Props {
  branches: { id: string; code: string; name: string }[];
  branchId: string;
  weekStart: string; // YYYY-MM-DD (Monday)
  day: string; // YYYY-MM-DD (selected day for the Day scale)
  view: ShiftView;
  scale: ShiftScale;
  /** Count of today's external (hotel-dispatched) reservations — shown as a
   *  badge on the Dispatch tab so desk knows when external bookings exist
   *  without having to switch tabs. */
  dispatchCount?: number;
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
function thisMonday(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - day);
  return now.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ShiftControls({ branches, branchId, weekStart, day, view, scale, dispatchCount = 0 }: Props) {
  const router = useRouter();
  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  function go(opts: { branch?: string; week?: string; day?: string; view?: ShiftView; scale?: ShiftScale }) {
    const branch = opts.branch ?? branchId;
    const v = opts.view ?? view;
    const sc = opts.scale ?? scale;
    const w = opts.week ?? weekStart;
    const dy = opts.day ?? day;
    router.push(`/shift-schedule?branch=${branch}&view=${v}&scale=${sc}&week=${w}&day=${dy}`);
  }

  const tabBtn = (active: boolean) =>
    cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold transition-colors', active ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'text-muted-foreground hover:bg-accent');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* subject: Station = live bed board, Therapist = roster, Dispatch =
          external (hotel-dispatched) reservations only. Dispatch shows a count
          badge so the desk doesn't need to switch tabs to know there's pending
          external work. */}
      <div className="inline-flex rounded-lg border border-border p-0.5">
        <button type="button" onClick={() => go({ view: 'station', scale: 'day' })} className={tabBtn(view === 'station')}>
          <BedDouble className="size-4" /> Station
        </button>
        <button type="button" onClick={() => go({ view: 'employee', scale: 'week' })} className={tabBtn(view === 'employee')}>
          <Users className="size-4" /> Therapist
        </button>
        <button type="button" onClick={() => go({ view: 'dispatch', scale: 'day' })} className={tabBtn(view === 'dispatch')}>
          <Hotel className="size-4" /> Dispatch
          {dispatchCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white tabular-nums">
              {dispatchCount}
            </span>
          )}
        </button>
      </div>

      {/* scale: week grid vs hourly day — Station/Dispatch are always per-day */}
      {view === 'employee' && (
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button type="button" onClick={() => go({ scale: 'week' })} className={tabBtn(scale === 'week')}>
            <CalendarDays className="size-4" /> Week
          </button>
          <button type="button" onClick={() => go({ scale: 'day' })} className={tabBtn(scale === 'day')}>
            <Clock className="size-4" /> Day
          </button>
        </div>
      )}

      <Select items={branchOptions} value={branchId} onValueChange={(v) => v && go({ branch: v })}>
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {scale === 'day' ? (
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
      ) : (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" onClick={() => go({ week: addDays(weekStart, -7) })}><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => go({ week: thisMonday() })}>This week</Button>
          <Button size="icon" variant="outline" onClick={() => go({ week: addDays(weekStart, 7) })}><ChevronRight className="size-4" /></Button>
        </div>
      )}
    </div>
  );
}
