'use client';

import { useEffect, useRef, useState } from 'react';

import type { DayOccupancy } from '@/lib/occupancy';

const hh = (h: number) => String(h % 24).padStart(2, '0');

// Combo chart: Station + Therapist occupancy as grouped bars, Utilization as a
// line, X axis = operating hours. Self-contained SVG (no chart lib). Measures
// its container so the hours stretch to fill the full card width; Y is scaled to
// the tallest value so overbooked (>100%) bars still fit.
export function UtilizationChart({ perHour }: { perHour: DayOccupancy['perHour'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const data = perHour;
  const n = data.length;

  const padL = 30;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const chartH = 160;
  const H = padT + chartH + padB;
  const W = Math.max(320, w);
  const baseY = padT + chartH;

  const slot = n > 0 ? (W - padL - padR) / n : 0;
  const maxVal = Math.max(1, ...data.flatMap((d) => [d.stationPct ?? 0, d.therapistPct ?? 0, d.utilizationPct ?? 0]));
  const y = (v: number) => padT + chartH * (1 - v / maxVal);
  const slotX = (i: number) => padL + i * slot;
  const center = (i: number) => slotX(i) + slot / 2;

  const gap = 4;
  const barW = Math.max(4, Math.min(18, (slot - 8) / 2 - gap / 2));
  const groupLeft = (slot - (barW * 2 + gap)) / 2;

  const ticks = [0, 0.5, 1, ...(maxVal > 1 ? [maxVal] : [])];

  // Utilization line broken into segments at null (future) hours.
  const segments: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  data.forEach((d, i) => {
    if (d.utilizationPct == null) { if (cur.length) { segments.push(cur); cur = []; } return; }
    cur.push({ x: center(i), y: y(d.utilizationPct) });
  });
  if (cur.length) segments.push(cur);

  return (
    <div ref={ref} className="w-full" style={{ minHeight: H }}>
      {w > 0 && (
        <svg width={W} height={H} className="block" role="img" aria-label="Hourly station and therapist occupancy with utilization line">
          {/* gridlines + y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[9px] font-bold tabular-nums">{Math.round(t * 100)}</text>
            </g>
          ))}

          {/* grouped bars */}
          {data.map((d, i) => {
            const sx = slotX(i) + groupLeft;
            return (
              <g key={d.hour}>
                {d.stationPct != null && (
                  <rect x={sx} y={y(d.stationPct)} width={barW} height={Math.max(0, baseY - y(d.stationPct))} rx={2} className="fill-indigo-500/75" />
                )}
                {d.therapistPct != null && (
                  <rect x={sx + barW + gap} y={y(d.therapistPct)} width={barW} height={Math.max(0, baseY - y(d.therapistPct))} rx={2} className="fill-teal-500/75" />
                )}
                <text x={center(i)} y={H - 7} textAnchor="middle" className="fill-muted-foreground text-[9px] font-bold tabular-nums">{hh(d.hour)}</text>
              </g>
            );
          })}

          {/* utilization line + dots */}
          {segments.map((seg, si) => (
            <polyline key={si} points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-amber-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {data.map((d, i) => d.utilizationPct == null ? null : (
            <circle key={`p${d.hour}`} cx={center(i)} cy={y(d.utilizationPct)} r={2.5} className="fill-amber-500" />
          ))}
        </svg>
      )}
    </div>
  );
}
