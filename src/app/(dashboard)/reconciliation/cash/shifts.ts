// Plain module (no 'use server') for cash-shift constants and types so they can
// be imported by both server actions and client components.

export const SHIFT_LABELS = ['AM', 'PM', 'Night', 'FullDay'] as const;
export type ShiftLabel = (typeof SHIFT_LABELS)[number];

export const CASH_SHIFTS_SETTING_KEY = 'cash_recon_shifts';
// AM→PM and PM→Night cut points (configurable in settings; stored "HH:MM,HH:MM").
export const CASH_WINDOWS_SETTING_KEY = 'cash_shift_windows';

// Default cut points (minutes of day, PHT): AM→PM at 14:00, PM→Night at 18:00.
export const DEFAULT_AM_PM_CUT = 840;
export const DEFAULT_PM_NIGHT_CUT = 1080;

// Canonical display/sort order, independent of the configurable cut points.
export const SHIFT_ORDER: Record<ShiftLabel, number> = { AM: 0, PM: 1, Night: 2, FullDay: 0 };

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

// Build the per-label [start, end) windows from the two cut points.
export function buildWindows(amPmCut: number, pmNightCut: number): Record<ShiftLabel, [number, number]> {
  return {
    AM: [0, amPmCut],
    PM: [amPmCut, pmNightCut],
    Night: [pmNightCut, 1440],
    FullDay: [0, 1440],
  };
}

// Default windows — fallback when no (valid) setting exists.
export const WINDOW: Record<ShiftLabel, [number, number]> = buildWindows(DEFAULT_AM_PM_CUT, DEFAULT_PM_NIGHT_CUT);

// "00:00–14:00" style label for a window; FullDay → "All day".
export function formatWindow(label: ShiftLabel, win: [number, number]): string {
  if (label === 'FullDay') return 'All day';
  const end = win[1] >= 1440 ? '24:00' : minToHHMM(win[1]);
  return `${minToHHMM(win[0])}–${end}`;
}

export interface ShiftStatus {
  label: ShiftLabel;
  windowLabel: string;
  openingCents: number;
  receivedCents: number;
  expectedCents: number;
  closed: { actualCents: number; varianceCents: number; reason: string | null } | null;
}
