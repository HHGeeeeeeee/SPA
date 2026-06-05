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

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoUTC = (dt: Date) => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
// UTC date math so a +N/-N day shift never drifts across a local-midnight / UTC boundary.
function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return isoUTC(new Date(Date.UTC(y, m - 1, d + delta)));
}
function thisMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return isoUTC(dt);
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