// Plain module (no 'use server') for cash-shift config types/helpers so they can
// be imported by both server actions and client components.
//
// A branch's cash-count day is an `open` time plus an ordered list of named
// shifts. The shifts are continuous: the first starts at `open`, each one starts
// where the previous ended, and the last ends at midnight (24:00). So a payment
// always falls into exactly one shift. Any number of shifts, any names — e.g.
// one "Full day", or "Day 09:00–17:00" + "Evening 17:00–24:00".

export const CASH_SHIFT_CONFIG_KEY = 'cash_shift_config';
export const DAY_END = 1440; // minutes of day = 24:00 (midnight)

export interface CashShift {
  name: string;
  end: number; // minutes of day; the last shift's end is DAY_END
}
export interface CashShiftConfig {
  open: number; // first shift's start, minutes of day
  shifts: CashShift[];
}

// The fixed shift set for every branch: AM / PM / GY (graveyard). There is no
// per-branch configuration. The `end` values are nominal placeholders only — a
// posting binds to whichever shift the cashier has OPEN (shift_id), not to a
// clock window, so these boundaries are never shown or used to bucket payments.
export const DEFAULT_CONFIG: CashShiftConfig = {
  open: 0,
  shifts: [
    { name: 'AM Shift', end: 480 },
    { name: 'PM Shift', end: 960 },
    { name: 'GY Shift', end: DAY_END },
  ],
};

export function hhmmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Like minToHHMM but renders day-end (1440) as "24:00" rather than "00:00".
export function formatMin(min: number): string {
  return min >= DAY_END ? '24:00' : minToHHMM(min);
}

export interface ShiftWindow { name: string; start: number; end: number }

// Resolve a config into its continuous per-shift windows.
export function windowsFromConfig(cfg: CashShiftConfig): ShiftWindow[] {
  const out: ShiftWindow[] = [];
  let start = cfg.open;
  for (const s of cfg.shifts) {
    out.push({ name: s.name, start, end: s.end });
    start = s.end;
  }
  return out;
}

export function formatWindow(start: number, end: number): string {
  return `${formatMin(start)}–${formatMin(end)}`;
}

// Validate/normalize a raw config (from JSON or client input). Returns null when
// invalid: shifts must be non-empty, named (unique), strictly increasing, start
// after `open`, and end exactly at midnight.
export function parseConfig(raw: unknown): CashShiftConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { open?: unknown; shifts?: unknown };
  const open = typeof o.open === 'number' ? o.open : null;
  const shiftsRaw = Array.isArray(o.shifts) ? o.shifts : null;
  if (open == null || open < 0 || open >= DAY_END || !shiftsRaw || shiftsRaw.length === 0) return null;

  const shifts: CashShift[] = [];
  const names = new Set<string>();
  let prev = open;
  for (const s of shiftsRaw) {
    if (!s || typeof s !== 'object') return null;
    const name = typeof (s as { name?: unknown }).name === 'string' ? (s as { name: string }).name.trim() : '';
    const end = typeof (s as { end?: unknown }).end === 'number' ? (s as { end: number }).end : null;
    if (!name || end == null) return null;
    if (end <= prev || end > DAY_END) return null;
    const key = name.toLowerCase();
    if (names.has(key)) return null;
    names.add(key);
    shifts.push({ name, end });
    prev = end;
  }
  if (shifts[shifts.length - 1].end !== DAY_END) return null;
  return { open, shifts };
}

export interface ShiftStatus {
  label: string;       // shift name
  windowLabel: string; // e.g. "09:00–17:00"
  firstOfDay: boolean; // first shift opens with no handover float
  openingCents: number;
  receivedCents: number;
  /** Counter cash — from order-level payments (sales orders paid in cash at
   *  the till). receivedCents = counterCashCents + arSettleCashCents. */
  counterCashCents: number;
  /** AR-settle cash — from SOA collections (third-party customer paid their
   *  monthly statement in cash). Same till impact, different origin. */
  arSettleCashCents: number;
  expectedCents: number;
  closed: { actualCents: number; varianceCents: number; reason: string | null } | null;
}
