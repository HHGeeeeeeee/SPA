import { createServiceClient } from '@/lib/supabase/server';

// Reservation statuses that are still "live" — they hold capacity/beds and can
// be flagged Overdue. Terminal statuses (converted/cancelled/no_show) are out.
export const ACTIVE_RESERVATION_STATUSES = ['reserved', 'confirmed'] as const;

// Fallback if the Settings row is missing.
export const DEFAULT_OVERDUE_GRACE_MIN = 30;

const GRACE_SETTING_KEY = 'reservation_overdue_grace_minutes';

// Global grace window (minutes). Past `desired_start + grace`, an active
// reservation is Overdue. Read from Settings; falls back to the default.
export async function getReservationGraceMinutes(): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', GRACE_SETTING_KEY)
    .is('branch_id', null)
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_OVERDUE_GRACE_MIN;
}

// Overdue = an active reservation whose desired start passed more than the grace
// window ago. Such reservations keep their status but auto-release pinned beds.
export function isReservationOverdue(opts: {
  status?: string;
  desiredStartIso: string;
  graceMin: number;
  nowMs?: number;
}): boolean {
  if (opts.status && !ACTIVE_RESERVATION_STATUSES.includes(opts.status as (typeof ACTIVE_RESERVATION_STATUSES)[number])) {
    return false;
  }
  const now = opts.nowMs ?? Date.now();
  return Date.parse(opts.desiredStartIso) + opts.graceMin * 60_000 < now;
}
