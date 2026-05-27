'use client';

import { useState } from 'react';
import { Users, ChevronDown, ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TherapistNow {
  id: string;
  name: string;
  code: string;
  shiftType: string;
  free: boolean;
  serviceName: string | null;
  since: string | null;
}

// The "therapists free now" tile — derived purely from the roster (on-shift =
// on-duty, no punch-clock). Click to expand the on-shift list (free vs busy),
// folding in what the standalone Availability page used to show.
export function TherapistsNowCard({ free, onShift, therapists }: { free: number; onShift: number; therapists: TherapistNow[] }) {
  const [open, setOpen] = useState(false);
  const canExpand = therapists.length > 0;
  return (
    <Card className="min-w-[200px] flex-1 p-3 sm:max-w-[280px]">
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        className={cn('flex w-full items-center justify-between gap-3 text-left', canExpand && 'cursor-pointer')}
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground leading-tight">Therapists free now</div>
          <div className={cn('mt-0.5 text-2xl font-extrabold tabular', free === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary')}>
            {free}<span className="text-base font-semibold text-muted-foreground"> / {onShift} on shift</span>
          </div>
        </div>
        {canExpand
          ? (open ? <ChevronDown className="size-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-5 shrink-0 text-muted-foreground" />)
          : <Users className="size-6 shrink-0 text-muted-foreground/50" />}
      </button>
      {open && canExpand && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {therapists.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
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
      )}
    </Card>
  );
}
