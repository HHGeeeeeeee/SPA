import { Card } from '@/components/ui/card';
import { CleanupSegment } from '@/components/shift-schedule/cleanup-segment';

export interface DayServiceBlock {
  name: string;
  startMin: number;
  endMin: number;
  ongoing: boolean;
  // End of the post-service bed-cleanup window (minute-of-day), when the bed is
  // still being held for cleanup. Drawn as a separate, distinct-colour block.
  cleanupEndMin?: number;
  // The order line, so the cleanup block can offer "Ready now".
  itemId?: string;
}
export interface DayRow {
  id: string;
  name: string;
  code: string;
  shiftType: string;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
  services: DayServiceBlock[];
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const SHIFT_STYLE: Record<string, string> = {
  regular: 'bg-primary/15',
  cross_branch: 'bg-amber-500/15',
  on_call: 'bg-blue-500/15',
};

export function DayTimeline({
  rows,
  windowStartMin,
  windowEndMin,
  subjectLabel,
}: {
  rows: DayRow[];
  windowStartMin: number;
  windowEndMin: number;
  subjectLabel: string;
}) {
  const total = Math.max(60, windowEndMin - windowStartMin);
  const pct = (min: number) => ((min - windowStartMin) / total) * 100;
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  // Give every hour a generous fixed width so the service + cleanup blocks
  // aren't cramped; the timeline scrolls horizontally when it overflows.
  const PX_PER_HOUR = 160;
  const LABEL_W = 160; // matches the w-40 name column
  const trackMinWidth = Math.round((total / 60) * PX_PER_HOUR);

  return (
    <Card className="p-0 overflow-x-auto">
      <div style={{ minWidth: LABEL_W + trackMinWidth }}>
        {/* hour axis */}
        <div className="flex border-b border-border">
          <div className="w-40 shrink-0 p-2 text-xs font-bold text-muted-foreground">{subjectLabel}</div>
          <div className="relative flex-1 h-8">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute top-0 bottom-0 border-l border-border/60 text-[10px] font-bold text-muted-foreground pl-1"
                style={{ left: `${pct(h * 60)}%` }}
              >
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-muted-foreground">No therapists scheduled this day.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex border-b border-border last:border-0">
              <div className="w-40 shrink-0 p-2">
                <div className="font-semibold text-sm">{r.name}</div>
                <div className="font-mono font-bold text-xs text-muted-foreground">{r.code}</div>
              </div>
              <div className="relative flex-1 h-12 my-1">
                {/* hour gridlines */}
                {hours.map((h) => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-border/40" style={{ left: `${pct(h * 60)}%` }} />
                ))}
                {/* shift window */}
                {r.shiftStartMin != null && r.shiftEndMin != null && (
                  <div
                    className={`absolute top-1 bottom-1 rounded-md ${SHIFT_STYLE[r.shiftType] ?? 'bg-muted'}`}
                    style={{ left: `${pct(r.shiftStartMin)}%`, width: `${pct(r.shiftEndMin) - pct(r.shiftStartMin)}%` }}
                    title={`${hhmm(r.shiftStartMin)}–${hhmm(r.shiftEndMin)}`}
                  />
                )}
                {/* service blocks (+ trailing cleanup block in a distinct colour) */}
                {r.services.map((s, i) => (
                  <div key={i} className="contents">
                    <div
                      className={`absolute top-2 bottom-2 rounded px-1 overflow-hidden text-[10px] font-bold leading-tight ${s.ongoing ? 'bg-blue-500/70 text-white' : 'bg-primary/70 text-white'}`}
                      style={{ left: `${pct(s.startMin)}%`, width: `${Math.max(2, pct(s.endMin) - pct(s.startMin))}%` }}
                      title={`${s.name} · ${hhmm(s.startMin)}–${hhmm(s.endMin)}`}
                    >
                      {s.name}
                    </div>
                    {s.cleanupEndMin != null && (
                      <CleanupSegment
                        itemId={s.itemId}
                        left={pct(s.endMin)}
                        width={Math.max(1.5, pct(s.cleanupEndMin) - pct(s.endMin))}
                        label={`Cleanup ${hhmm(s.endMin)}–${hhmm(s.cleanupEndMin)}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
