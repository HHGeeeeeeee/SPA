'use client';

import { useState } from 'react';
import { BedDouble, ChevronDown, ChevronRight, Scissors, Hand } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface StationNow {
  id: string;
  name: string;
  type: string; // 'massage_bed' | 'hair_chair' | 'nail_station'
  free: boolean;
  occupant: string | null;
}

export interface StationTypeSummary {
  type: string;
  label: string; // 'bed' | 'hair' | 'nail'
  free: number;
  total: number;
}

// "Stations open now" tile — rolls together massage beds + hair chairs +
// nail stations so the desk sees walk-in capacity across every business unit.
// Headline = grand total free/total; subline = per-type breakdown so a glance
// answers "can I take a hair walk-in right now?" without expanding.
const ICON_BY_TYPE: Record<string, React.ComponentType<{ className?: string }>> = {
  massage_bed: BedDouble,
  hair_chair: Scissors,
  nail_station: Hand,
};
const ICON_DEFAULT = BedDouble;
const TYPE_LABEL_PLURAL: Record<string, string> = {
  massage_bed: 'Beds',
  hair_chair: 'Hair chairs',
  nail_station: 'Nail stations',
};

export function StationsNowCard({
  free,
  total,
  byType,
  stations,
}: {
  free: number;
  total: number;
  byType: StationTypeSummary[];
  stations: StationNow[];
}) {
  const [open, setOpen] = useState(false);
  const canExpand = stations.length > 0;
  // Group stations by type so the expanded list reads as sub-tables, not one
  // flat list. byType already gives us the order + labels.
  const stationsByType = new Map<string, StationNow[]>();
  for (const s of stations) {
    const arr = stationsByType.get(s.type) ?? [];
    arr.push(s);
    stationsByType.set(s.type, arr);
  }
  return (
    <Card className="min-w-[220px] flex-1 p-3 sm:max-w-[320px]">
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        className={cn('flex w-full items-center justify-between gap-3 text-left', canExpand && 'cursor-pointer')}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground leading-tight">Stations open now</div>
          <div className={cn('mt-0.5 text-2xl font-extrabold tabular', free === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary')}>
            {free}<span className="text-base font-semibold text-muted-foreground"> / {total}</span>
          </div>
          {/* Per-type subline: "bed 8·8 · hair 1·2 · nail 2·2". Types with no
              provisioned stations still show as "x 0·0" so the desk knows the
              business unit isn't set up rather than wondering where it went. */}
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold text-muted-foreground tabular">
            {byType.map((t, i) => (
              <span key={t.type} className={cn('inline-flex items-baseline gap-1', t.total === 0 && 'opacity-50')}>
                {i > 0 && <span className="text-muted-foreground/40">·</span>}
                <span>{t.label}</span>
                <span className={cn('font-bold', t.total > 0 && t.free === 0 && 'text-amber-600 dark:text-amber-400')}>
                  {t.free}·{t.total}
                </span>
              </span>
            ))}
          </div>
        </div>
        {canExpand
          ? (open ? <ChevronDown className="size-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-5 shrink-0 text-muted-foreground" />)
          : <BedDouble className="size-6 shrink-0 text-muted-foreground/50" />}
      </button>
      {open && canExpand && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          {byType
            .filter((t) => (stationsByType.get(t.type)?.length ?? 0) > 0)
            .map((t) => {
              const rows = stationsByType.get(t.type) ?? [];
              const Icon = ICON_BY_TYPE[t.type] ?? ICON_DEFAULT;
              return (
                <div key={t.type} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
                    <Icon className="size-3" />
                    {TYPE_LABEL_PLURAL[t.type] ?? t.label} · {t.free}/{t.total}
                  </div>
                  {rows.map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-2 pl-4 text-xs">
                      <span className="font-semibold truncate">{b.name}</span>
                      {b.free ? (
                        <Badge className="font-bold text-[10px] shrink-0">Free</Badge>
                      ) : (
                        <span className="text-muted-foreground truncate shrink-0 max-w-[60%] text-right">{b.occupant}</span>
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
