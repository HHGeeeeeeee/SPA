'use client';

import { useEffect, useRef, useState } from 'react';

import type { DayOccupancy } from '@/lib/occupancy';

const hh = (h: number) => String(h % 24).padStart(2, '0');

// Compact peso label for the right-hand revenue axis (₱ thousands when large).
function revLabel(cents: number): string {
  const p = cents / 100;
  if (p >= 1000) return `${(p / 1000).toFixed(p >= 10000 ? 0 : 1)}k`;
  return `${Math.round(p)}`;
}

// Monotone cubic (Fritsch–Carlson) → cubic-bezier. Smooth, but unlike Catmull-Rom
// it never overshoots the data range, so a 0-revenue hour can't dip below the
// baseline into negative territory.
function smoothTop(pts: { x: number; y: number }[]): string {
  const nP = pts.length;
  if (nP === 0) return '';
  if (nP === 1) return `M ${pts[0].x},${pts[0].y}`;

  const dx: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < nP - 1; i++) {
    const hx = pts[i + 1].x - pts[i].x;
    dx.push(hx);
    delta.push(hx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / hx);
  }

  const m = new Array<number>(nP);
  m[0] = delta[0];
  m[nP - 1] = delta[nP - 2];
  for (let i = 1; i < nP - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  // Clamp tangents so each segment stays monotone (no overshoot).
  for (let i = 0; i < nP - 1; i++) {
    if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }

  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < nP - 1; i++) {
    const hx = dx[i];
    d += ` C ${pts[i].x + hx / 3},${pts[i].y + (m[i] * hx) / 3} ${pts[i + 1].x - hx / 3},${pts[i + 1].y - (m[i + 1] * hx) / 3} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

// Combo chart: Station + Therapist occupancy as grouped bars, Utilization as a
// line (left % axis), and an hourly revenue area as a smooth backdrop on its own
// right axis. Self-contained SVG (no chart lib); measures its container width.
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

  const padL = 40;
  const padR = 48;
  const padT = 14;
  const padB = 28;
  const chartH = 240; // 1.5× the previous 160
  const H = padT + chartH + padB;
  const W = Math.max(360, w);
  const baseY = padT + chartH;
  const FONT = 12; // axis font ≥ the body text size

  const slot = n > 0 ? (W - padL - padR) / n : 0;
  const maxVal = Math.max(1, ...data.flatMap((d) => [d.stationPct ?? 0, d.therapistPct ?? 0, d.utilizationPct ?? 0]));
  const y = (v: number) => padT + chartH * (1 - v / maxVal);
  const slotX = (i: number) => padL + i * slot;
  const center = (i: number) => slotX(i) + slot / 2;

  const gap = 4;
  const barW = Math.max(4, Math.min(20, (slot - 8) / 2 - gap / 2));
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

  // Revenue area on its own right-hand scale (max hour → full height).
  const maxRev = Math.max(0, ...data.map((d) => d.revenueCents));
  const ry = (cents: number) => baseY - chartH * (maxRev > 0 ? cents / maxRev : 0);
  const revPts = data.map((d, i) => ({ x: center(i), y: ry(d.revenueCents) }));
  const revArea = maxRev > 0 && n > 0
    ? `${smoothTop(revPts)} L ${revPts[n - 1].x},${baseY} L ${revPts[0].x},${baseY} Z`
    : null;
  const revTicks = maxRev > 0 ? [0, 0.5, 1] : [];

  return (
    <div ref={ref} className="w-full" style={{ minHeight: H }}>
      {w > 0 && (
        <svg width={W} height={H} className="block" role="img" aria-label="Hourly station and therapist occupancy, utilization line, revenue area">
          {/* revenue area (smooth backdrop, behind everything) */}
          {revArea && <path d={revArea} className="fill-muted-foreground/15" />}

          {/* left axis: occupancy / utilization % */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground font-bold tabular-nums" fontSize={FONT}>{Math.round(t * 100)}</text>
            </g>
          ))}

          {/* right axis: revenue (₱) */}
          {revTicks.map((f) => (
            <text key={f} x={W - padR + 6} y={baseY - chartH * f + 4} textAnchor="start" className="fill-muted-foreground/80 font-semibold tabular-nums" fontSize={FONT}>
              {revLabel(maxRev * f)}
            </text>
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
                <text x={center(i)} y={H - 9} textAnchor="middle" className="fill-muted-foreground font-bold tabular-nums" fontSize={FONT}>{hh(d.hour)}</text>
              </g>
            );
          })}

          {/* utilization line + dots */}
          {segments.map((seg, si) => (
            <polyline key={si} points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="stroke-amber-500" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {data.map((d, i) => d.utilizationPct == null ? null : (
            <circle key={`p${d.hour}`} cx={center(i)} cy={y(d.utilizationPct)} r={3} className="fill-amber-500" />
          ))}
        </svg>
      )}
    </div>
  );
}
