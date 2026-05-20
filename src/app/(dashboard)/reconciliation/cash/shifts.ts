// Plain module (no 'use server') for cash-shift constants and types so they can
// be imported by both server actions and client components.

export const SHIFT_LABELS = ['AM', 'PM', 'Night', 'FullDay'] as const;
export type ShiftLabel = (typeof SHIFT_LABELS)[number];

// Shift time windows in minutes of day (PHT).
export const WINDOW: Record<ShiftLabel, [number, number]> = {
  AM: [0, 840],        // –14:00
  PM: [840, 1080],     // 14:00–18:00
  Night: [1080, 1440], // 18:00–
  FullDay: [0, 1440],
};

export const CASH_SHIFTS_SETTING_KEY = 'cash_recon_shifts';

export interface ShiftStatus {
  label: ShiftLabel;
  openingCents: number;
  receivedCents: number;
  expectedCents: number;
  closed: { actualCents: number; varianceCents: number; reason: string | null } | null;
}
