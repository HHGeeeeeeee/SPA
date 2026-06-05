'use client';

import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ShiftCell, type ShiftData } from '@/components/shift-schedule/shift-cell';

export interface StaffWeekDay {
  date: string;
  dow: string;
  label: string;
}
export interface StaffWeekEmployee {
  id: string;
  name: string;
  employee_code: string;
  home_branch_id: string | null;
  position_code: string | null;
  /** AM / Mid / PM band from the week's clock-in — drives the row order and the
   *  little tag next to the name. null = no working shift this week. */
  shiftBand?: 'am' | 'mid' | 'pm' | null;
}

// Shift-band tag style — lets the desk read who's early/mid/late at a glance
// (the rows are already ordered AM -> Mid -> PM upstream).
const BAND_TAG: Record<'am' | 'mid' | 'pm', { label: string; cls: string }> = {
  am: { label: 'AM', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  mid: { label: 'Mid', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  pm: { label: 'PM', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-400' },
};
export interface StaffWeekBranch {
  id: string;
  code: string;
}

// Stable display order for the known service-providing positions. Anything
// not in this list shows up after, in code order. Receptionists / managers
// don't appear in this grid (the page filters them out upstream).
const POSITION_ORDER = ['MASSAGE_THERAPIST', 'MASSAGE_NEWBI', 'HAIR_STYLIST', 'NAIL_TECHNICIAN'];
const POSITION_LABEL: Record<string, string> = {
  MASSAGE_THERAPIST: 'Massage Therapists',
  MASSAGE_NEWBI: 'Massage Newbi',
  HAIR_STYLIST: 'Hair Stylists',
  NAIL_TECHNICIAN: 'Nail Technicians',
};
const UNASSIGNED_KEY = '_unassigned';
const UNASSIGNED_LABEL = 'No position set';

// Pre-grouped + ordered list of (position, employees). The grouping logic
// runs at render time on the client because positions list is small (<6
// roles, <50 employees) and recomputing dodges a server prop round-trip.
function groupByPosition(employees: StaffWeekEmployee[]): { code: string; label: string; members: StaffWeekEmployee[] }[] {
  const groups = new Map<string, StaffWeekEmployee[]>();
  for (const e of employees) {
    const key = e.position_code ?? UNASSIGNED_KEY;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  const out: { code: string; label: string; members: StaffWeekEmployee[] }[] = [];
  for (const code of POSITION_ORDER) {
    const members = groups.get(code);
    if (members && members.length) {
      out.push({ code, label: POSITION_LABEL[code] ?? code, members });
      groups.delete(code);
    }
  }
  for (const [code, members] of groups) {
    if (code === UNASSIGNED_KEY) continue; // append last
    out.push({ code, label: POSITION_LABEL[code] ?? code.replace(/_/g, ' '), members });
  }
  const orphan = groups.get(UNASSIGNED_KEY);
  if (orphan && orphan.length) out.push({ code: UNASSIGNED_KEY, label: UNASSIGNED_LABEL, members: orphan });
  return out;
}

/**
 * The Staff > Week roster table — rows grouped by position with collapsible
 * section headers. Mirrors the visual idea the user showed (hotel "All Room
 * Types" → "Beach Front Deluxe…" → tents) so a desk with massage + hair +
 * nail staff can hide the roles they're not editing.
 *
 * Collapse state persists in localStorage per branch so each branch's desk
 * keeps its preferred view.
 */
export function StaffWeekGrid({
  branchId,
  branches,
  employees,
  days,
  shiftLookup,
  canManageRoster,
}: {
  branchId: string;
  branches: StaffWeekBranch[];
  employees: StaffWeekEmployee[];
  days: StaffWeekDay[];
  /** key = `${employee_id}:${date}`. null = no shift on that day. */
  shiftLookup: Record<string, ShiftData | null>;
  canManageRoster: boolean;
}) {
  const groups = groupByPosition(employees);
  const STORAGE_KEY = `hhg-spa:staff-week:collapsed:${branchId}`;
  // Default: every group expanded. The user can collapse and the preference
  // sticks per-branch. New positions don't auto-collapse — explicit opt-in.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw)));
    } catch {
      /* localStorage unavailable — default to expanded */
    }
  }, [STORAGE_KEY]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* same defensive ignore */
    }
  }, [collapsed, STORAGE_KEY]);

  const toggle = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.code));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.code)));

  const dayCount = days.length;

  return (
    <Card className="p-0 overflow-auto max-h-[calc(100vh-16rem)]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {/* Top-left corner: frozen on both axes. Doubles as the master
                collapse / expand toggle — clicking it flips every group at
                once, like the hotel system's "All Room Types" handle. */}
            <th className="text-left font-bold text-sm p-3 w-48 sticky left-0 top-0 z-30 bg-card border-b border-border">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1 text-left hover:text-foreground transition-colors"
              >
                {allCollapsed
                  ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                Staff
              </button>
            </th>
            {days.map((d) => (
              <th key={d.date} className="text-center font-bold text-xs p-2 min-w-[88px] sticky top-0 z-20 bg-card border-b border-border">
                <div>{d.dow}</div>
                <div className="font-medium text-muted-foreground tabular">{d.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.code);
            return (
              <Fragment key={g.code}>
                {/* Group header — chevron + label + member count. Spans the
                    full row width so the click target is large. Sticky-left
                    on the first cell keeps the label visible when the user
                    scrolls horizontally on a narrow viewport. */}
                <tr className="border-y-2 border-border bg-muted/40">
                  <td
                    className="p-2 sticky left-0 z-10 bg-muted/40"
                    colSpan={1}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(g.code)}
                      className="flex w-full items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isCollapsed
                        ? <ChevronRight className="size-3.5 shrink-0" />
                        : <ChevronDown className="size-3.5 shrink-0" />}
                      <span>{g.label}</span>
                      <span className="font-extrabold text-foreground/80 tabular">{g.members.length}</span>
                    </button>
                  </td>
                  {/* Filler cells preserve column widths so the table stays
                      perfectly aligned whether the group is expanded or not. */}
                  <td className="bg-muted/40" colSpan={dayCount} />
                </tr>
                {!isCollapsed && g.members.map((e) => (
                  <tr key={e.id} className="border-b border-border">
                    <td className="p-3 sticky left-0 z-10 bg-card">
                      <div className="font-semibold text-sm">
                        {e.name}
                        {e.shiftBand && (
                          <span className={cn(
                            'ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold',
                            BAND_TAG[e.shiftBand].cls,
                          )}>
                            {BAND_TAG[e.shiftBand].label}
                          </span>
                        )}
                        {e.home_branch_id !== branchId && (
                          <span className={cn(
                            'ml-2 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5',
                            'text-[10px] font-bold text-amber-700 dark:text-amber-400',
                          )}>
                            from {branches.find((b) => b.id === e.home_branch_id)?.code ?? '?'}
                          </span>
                        )}
                      </div>
                      <div className="font-mono font-bold text-xs text-muted-foreground">{e.employee_code}</div>
                    </td>
                    {days.map((d) => (
                      <td key={d.date} className="p-1 align-middle">
                        <ShiftCell
                          employeeId={e.id}
                          employeeName={e.name}
                          branchId={branchId}
                          date={d.date}
                          shift={shiftLookup[`${e.id}:${d.date}`] ?? null}
                          visiting={e.home_branch_id !== branchId}
                          readOnly={!canManageRoster}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
