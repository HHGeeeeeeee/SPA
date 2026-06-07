// Shared therapist-eligibility rules. Both the reservation "Next available"
// calc (server) and the Sales Order auto-assign / picker (client) use these so
// the rules can't silently drift apart. (On-shift and not-busy are derived from
// each context's own live data and stay there; these are the pure rule bits.)

export const ANY_GENDER = '__any__';

// Can the therapist perform this specific service group? No group = anyone.
export function canPerformGroup(capabilities: string[], group: string | null | undefined): boolean {
  return !group || capabilities.includes(group);
}

// Can the therapist perform any service group within a set (e.g. a whole service
// category, where the exact service isn't chosen yet)? Empty set = no constraint.
export function canPerformAny(capabilities: string[], groups: Set<string>): boolean {
  return groups.size === 0 || capabilities.some((c) => groups.has(c));
}

// Does the therapist's gender match the preference? No pref / Any = anyone.
export function matchesGender(gender: string | null | undefined, pref: string | null | undefined): boolean {
  return !pref || pref === ANY_GENDER || gender === pref;
}

// Half-open interval overlap (all values in the same unit, e.g. epoch ms).
export function overlaps(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && s2 < e1;
}

export interface TimeWin { s: number; e: number }
export interface BookingWin extends TimeWin { item: string }
export type UnavailableReason = 'in_service' | 'booked' | 'off' | 'absent';
export interface PlanStatus {
  available: boolean;
  reason: UnavailableReason | null;
  /** Estimated free time (ISO) when busy/booked, for a "free ~HH:mm" hint. */
  freeAtIso: string | null;
}

/**
 * Is a therapist free for a service line at its PLANNED start? Checked against
 * the line's [planStart, planEnd) window:
 *   absent  — an absence block overlaps it
 *   off     — not on shift at planStart (no shift window covers it)
 *   booked  — another draft/in-service line overlaps it (excluding this line)
 * Priority absent > off > booked. When planStart is null (no booked time yet)
 * we can't reason about a future slot, so fall back to "in service right now".
 */
export function therapistPlanStatus(opts: {
  planStart: number | null;
  planEnd: number | null;
  shiftWins: TimeWin[];
  bookingWins: BookingWin[];
  blockWins: TimeWin[];
  excludeItem?: string;
  busyNow: boolean;
  busyNowEndIso: string | null;
}): PlanStatus {
  const { planStart, planEnd, shiftWins, bookingWins, blockWins, excludeItem, busyNow, busyNowEndIso } = opts;
  // No planned time → degrade to the "currently mid-service" signal.
  if (planStart == null || planEnd == null) {
    return { available: !busyNow, reason: busyNow ? 'in_service' : null, freeAtIso: busyNow ? busyNowEndIso : null };
  }
  if (blockWins.some((w) => overlaps(planStart, planEnd, w.s, w.e))) {
    return { available: false, reason: 'absent', freeAtIso: null };
  }
  const onShift = shiftWins.some((w) => planStart >= w.s && planStart < w.e);
  if (!onShift) return { available: false, reason: 'off', freeAtIso: null };
  const clashes = bookingWins.filter((w) => w.item !== excludeItem && overlaps(planStart, planEnd, w.s, w.e));
  if (clashes.length > 0) {
    const freeMs = Math.max(...clashes.map((w) => w.e));
    return { available: false, reason: 'booked', freeAtIso: new Date(freeMs).toISOString() };
  }
  return { available: true, reason: null, freeAtIso: null };
}
