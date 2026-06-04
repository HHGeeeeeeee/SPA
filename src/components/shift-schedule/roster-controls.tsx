'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TopBarPortal } from '@/components/layout/topbar-portal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

// Branch switcher (hoisted to the top bar) + week navigation for the roster.
// The Shift Schedule page is week-only — no view/scale toggles like the Calendar.
export function RosterControls({
  branches,
  branchId,
  weekStart,
}: {
  branches: { id: string; code: string; name: string }[];
  branchId: string;
  weekStart: string; // YYYY-MM-DD (Monday)
}) {
  const router = useRouter();
  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  const go = (opts: { branch?: string; week?: string }) => {
    const branch = opts.branch ?? branchId;
    const week = opts.week ?? weekStart;
    router.push(`/shift-schedule?branch=${branch}&week=${week}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Branch switcher lives in the global top bar (top-right), hoisted via
          the topbar portal slot — same as the Calendar's. */}
      <TopBarPortal>
        <Select items={branchOptions} value={branchId} onValueChange={(v) => v && go({ branch: v })}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TopBarPortal>

      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" onClick={() => go({ week: addDays(weekStart, -7) })}><ChevronLeft className="size-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => go({ week: thisMonday() })}>This week</Button>
        <Button size="icon" variant="outline" onClick={() => go({ week: addDays(weekStart, 7) })}><ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}