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
