'use client';

import { useState } from 'react';
import { Users, ChevronDown, ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface StaffNow {
  id: string;
  name: string;
  code: string;
  /** Position code (e.g. MASSAGE_THERAPIST). null = no position recorded. */
  positionCode: string | null;
  shiftType: string;
  free: boolean;
  serviceName: string | null;
  since: string | null;
}

export interface PositionSummary {
  code: string;
  label: string;
  free: number;
  onShift: number;
}

const POSITION_LABEL_PLURAL: Record<string, string> = {
  MASSAGE_THERAPIST: 'Massage',
  MASSAGE_NEWBI: 'Newbi',
  HAIR_STYLIST: 'Hair',
  NAIL_TECHNICIAN: 'Nail',
};

// "Staff free now" tile — every on-shift service-providing employee
// (massage / hair / nail). Receptionists and managers are pre-filtered server-
// side because they're never assigned to bookings. Headline = grand total;
// per-position subline keeps the role breakdown visible without expanding.
export function StaffNowCard({
  free,
  onShift,
  byPosition,
  staff,
}: {
  free: number;
  onShift: number;
  byPosition: PositionSummary[];
  staff: StaffNow[];
}) {
  const [open, setOpen] = useState(false);
  const canExpand = staff.length > 0;
  // Group by position for the expanded list so it reads like the subline.
  const staffByPosition = new Map<string, StaffNow[]>();
  for (const t of staff) {
    const key = t.positionCode ?? '_other';
    const arr = staffByPosition.get(key) ?? [];
    arr.push(t);
    staffByPosition.set(key, arr);
  }
  return (
    <Card className="min-w-[240px] flex-1 p-3 sm:max-w-[360px]">
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        className={cn('flex w-full items-center justify-between gap-3 text-left', canExpand && 'cursor-pointer')}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground leading-tight">Staff free now</div>
          <div className={cn('mt-0.5 text-2xl font-extrabold tabular', free === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary')}>
            {free}<span className="text-base font-semibold text-muted-foreground"> / {onShift} on shift</span>
          </div>
          {/* Per-position subline: "massage 10·13 · hair 1·2 · nail 2·2".
              Hidden entirely when no positions are on shift (nothing to break
              down). */}
          {byPosition.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold text-muted-foreground tabular">
              {byPosition.map((p, i) => (
                <span key={p.code} className="inline-flex items-baseline gap-1">
                  {i > 0 && <span className="text-muted-foreground/40">·</span>}
                  <span>{p.label}</span>
                  <span className={cn('font-bold', p.free === 0 && p.onShift > 0 && 'text-amber-600 dark:text-amber-400')}>
                    {p.free}·{p.onShift}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        {canExpand
          ? (open ? <ChevronDown className="size-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-5 shrink-0 text-muted-foreground" />)
          : <Users className="size-6 shrink-0 text-muted-foreground/50" />}
      </button>
      {open && canExpand && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          {byPosition.map((p) => {
            const rows = staffByPosition.get(p.code) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={p.code} className="flex flex-col gap-0.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
                  {POSITION_LABEL_PLURAL[p.code] ?? p.label} · {p.free}/{p.onShift}
                </div>
                {rows.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 pl-3 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold truncate">{t.name}</span>
                      <span className="font-mono font-bold text-[10px] text-muted-foreground">{t.code}</span>
                      {t.shiftType === 'cross_branch' && <Badge variant="secondary" className="font-bold text-[9px]">cross</Badge>}
                    </span>
                    {t.free ? (
                      <Badge className="font-bold text-[10px] shrink-0">Free</Badge>
                    ) : (
                      <span className="text-muted-foreground truncate shrink-0 max-w-[55%] text-right">
                        {t.serviceName}{t.since ? ` · ${t.since}` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
