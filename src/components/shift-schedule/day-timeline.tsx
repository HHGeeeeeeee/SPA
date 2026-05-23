import { Card } from '@/components/ui/card';
import { CleanupSegment } from '@/components/shift-schedule/cleanup-segment';

export interface DayServiceBlock {
  // Three stacked lines: primary name, service category, time range.
  line1: string;
  line2?: string;
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

// A reservation is upcoming, unassigned demand — no bed and no therapist yet —
// so it never lives in a bed/therapist row. It rides its own lane at the top of
// the timeline, on the same time axis, so staff can eyeball it against free beds.
export interface ReservationBlock {
  id: string;
  guest: string;
  // Second line: service category + party size (e.g. "Massage · 2p").
  line2?: string;
  startMin: number;
  endMin: number;
  // External (in-room at a hotel) reservations don't consume a bed here.
  external?: boolean;
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Vertical height (px) of one stacked lane within a resource row.
const LANE_H = 56;

// Greedy interval partitioning: each block gets the first lane whose previous
// block (incl. its cleanup tail) has already ended. Overlapping blocks land in
// separate lanes so they stack instead of covering each other.
function assignLanes(blocks: { startMin: number; endMin: number; cleanupEndMin?: number }[]): { lanes: number[]; count: number } {
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[a].startMin - blocks[b].startMin);
  const laneEnds: number[] = [];
  const lanes = new Array(blocks.length).fill(0);
  for (const i of order) {
    const s = blocks[i];
    const end = s.cleanupEndMin ?? s.endMin;
    let placed = laneEnds.findIndex((e) => s.startMin >= e);
    if (placed === -1) { placed = laneEnds.length; laneEnds.push(0); }
    lanes[i] = placed;
    laneEnds[placed] = end;
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
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
  nowMin = null,
  reservations = [],
}: {
  rows: DayRow[];
  windowStartMin: number;
  windowEndMin: number;
  subjectLabel: string;
  nowMin?: number | null;
  reservations?: ReservationBlock[];
}) {
  const total = Math.max(60, windowEndMin - windowStartMin);
  const pct = (min: number) => ((min - windowStartMin) / total) * 100;
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);
  // The "now" marker only shows when it falls inside the visible window.
  const showNow = nowMin != null && nowMin >= windowStartMin && nowMin <= windowEndMin;

  // Give every hour a generous fixed width so the service + cleanup blocks
  // aren't cramped; the timeline scrolls horizontally when it overflows.
  const PX_PER_HOUR = 160;
  const LABEL_W = 160; // matches the w-40 name column
  const trackMinWidth = Math.round((total / 60) * PX_PER_HOUR);

  return (
    <Card className="p-0 overflow-x-auto">
      <div style={{ minWidth: LABEL_W + trackMinWidth }}>
        {/* hour axis */}
        <div className="flex border-b border-border bg-muted/40">
          <div className="w-40 shrink-0 p-2 flex items-center justify-center text-center text-xs font-bold text-muted-foreground">{subjectLabel}</div>
          <div className="relative flex-1 h-9">
            {/* hour ticks */}
            {hours.map((h) => (
              <div key={`t${h}`} className="absolute top-0 bottom-0 border-l border-border/50" style={{ left: `${pct(h * 60)}%` }} />
            ))}
            {/* half-hour minor ticks (lower half, faint) */}
            {hours.slice(0, -1).map((h) => (
              <div key={`m${h}`} className="absolute bottom-0 h-2 border-l border-border/30" style={{ left: `${pct(h * 60 + 30)}%` }} />
            ))}
            {/* hour labels centred within each hour column */}
            {hours.slice(0, -1).map((h) => (
              <div
                key={`l${h}`}
                className="absolute top-0 bottom-0 flex items-center justify-center text-xs font-bold text-foreground tabular-nums"
                style={{ left: `${pct(h * 60)}%`, width: `${pct((h + 1) * 60) - pct(h * 60)}%` }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
            {/* now marker */}
            {showNow && (
              <div className="absolute top-0 bottom-0 z-10 -translate-x-1/2 flex flex-col items-center" style={{ left: `${pct(nowMin!)}%` }}>
                <span className="rounded bg-red-500 px-1 text-[9px] font-bold leading-tight text-white">{hhmm(nowMin!)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming reservations — unassigned demand, stacked on its own lane */}
        {reservations.length > 0 && (() => {
          const { lanes, count } = assignLanes(reservations);
          return (
            <div className="flex border-b-2 border-violet-500/30 bg-violet-500/5">
              <div className="w-40 shrink-0 p-2 text-center flex flex-col justify-center">
                <div className="font-semibold text-sm text-violet-700 dark:text-violet-300">Reservations</div>
                <div className="font-bold text-xs text-muted-foreground">{reservations.length} upcoming</div>
              </div>
              <div className="relative flex-1 my-1" style={{ height: count * LANE_H }}>
                {hours.map((h) => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-border/40" style={{ left: `${pct(h * 60)}%` }} />
                ))}
                {reservations.map((s, i) => (
                  <div
                    key={s.id}
                    className="absolute rounded border border-dashed border-violet-500/70 bg-violet-500/20 px-1.5 flex flex-col items-center justify-center text-center overflow-hidden text-[10px] leading-tight text-violet-950 dark:text-violet-100"
                    style={{ left: `${pct(s.startMin)}%`, width: `${Math.max(2, pct(s.endMin) - pct(s.startMin))}%`, top: lanes[i] * LANE_H + 3, height: LANE_H - 6 }}
                    title={`${s.guest}${s.line2 ? ` · ${s.line2}` : ''}${s.external ? ' · in-room' : ''} · ${hhmm(s.startMin)}–${hhmm(s.endMin)}`}
                  >
                    <span className="truncate font-bold">{s.guest}{s.external && ' 🏨'}</span>
                    {s.line2 && <span className="truncate font-semibold opacity-90">{s.line2}</span>}
                    <span className="truncate font-semibold tabular-nums opacity-80">{hhmm(s.startMin)}–{hhmm(s.endMin)}</span>
                  </div>
                ))}
                {showNow && (
                  <div className="absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: `${pct(nowMin!)}%` }} />
                )}
              </div>
            </div>
          );
        })()}

        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-muted-foreground">No therapists scheduled this day.</div>
        ) : (
          rows.map((r) => {
            const { lanes, count } = assignLanes(r.services);
            return (
            <div key={r.id} className="flex border-b border-border last:border-0">
              <div className="w-40 shrink-0 p-2 text-center flex flex-col justify-center">
                <div className="font-semibold text-sm">{r.name}</div>
                <div className="font-mono font-bold text-xs text-muted-foreground">{r.code}</div>
              </div>
              <div className="relative flex-1 my-1" style={{ height: count * LANE_H }}>
                {/* hour gridlines */}
                {hours.map((h) => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-border/40" style={{ left: `${pct(h * 60)}%` }} />
                ))}
                {/* shift window (spans the whole row, behind the lanes) */}
                {r.shiftStartMin != null && r.shiftEndMin != null && (
                  <div
                    className={`absolute top-1 bottom-1 rounded-md ${SHIFT_STYLE[r.shiftType] ?? 'bg-muted'}`}
                    style={{ left: `${pct(r.shiftStartMin)}%`, width: `${pct(r.shiftEndMin) - pct(r.shiftStartMin)}%` }}
                    title={`${hhmm(r.shiftStartMin)}–${hhmm(r.shiftEndMin)}`}
                  />
                )}
                {/* service blocks (+ trailing cleanup), stacked into lanes when overlapping */}
                {r.services.map((s, i) => (
                  <div key={i} className="contents">
                    <div
                      className={`absolute rounded px-1.5 flex flex-col items-center justify-center text-center overflow-hidden text-[10px] leading-tight ${s.ongoing ? 'bg-blue-500/70 text-white' : 'bg-primary/70 text-white'}`}
                      style={{ left: `${pct(s.startMin)}%`, width: `${Math.max(2, pct(s.endMin) - pct(s.startMin))}%`, top: lanes[i] * LANE_H + 3, height: LANE_H - 6 }}
                      title={`${s.line1}${s.line2 ? ` · ${s.line2}` : ''} · ${hhmm(s.startMin)}–${hhmm(s.endMin)}`}
                    >
                      <span className="truncate font-bold">{s.line1}</span>
                      {s.line2 && <span className="truncate font-semibold opacity-90">{s.line2}</span>}
                      <span className="truncate font-semibold tabular-nums opacity-80">
                        {hhmm(s.startMin)}{s.ongoing ? '–~' : '–'}{hhmm(s.endMin)}
                      </span>
                    </div>
                    {s.cleanupEndMin != null && (
                      <CleanupSegment
                        itemId={s.itemId}
                        left={pct(s.endMin)}
                        width={Math.max(1.5, pct(s.cleanupEndMin) - pct(s.endMin))}
                        top={lanes[i] * LANE_H + 3}
                        height={LANE_H - 6}
                        label={`Cleanup ${hhmm(s.endMin)}–${hhmm(s.cleanupEndMin)}`}
                      />
                    )}
                  </div>
                ))}
                {/* now line */}
                {showNow && (
                  <div className="absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: `${pct(nowMin!)}%` }} />
                )}
              </div>
            </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
