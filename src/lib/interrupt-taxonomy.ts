// Shared taxonomy for the service-interrupt flow. The dialog renders these
// dropdowns and the server action validates against the same arrays — single
// source of truth so a typo can't slip into one side without the other.
//
// Hidden from the UI but accepted by the server / schema (so historical rows
// stay valid + we can re-enable without a migration):
//   - `partial_charge`  legacy prorated billing
//   - `reschedule`      paused 2026-05-31 per user request; the Pending
//                       Reschedules page + sidebar entry are also hidden.
//                       Re-enable by adding it back to INTERRUPT_HANDLINGS
//                       below AND un-hiding /sales-orders/reschedules.

export type InterruptHandling = 'full_charge' | 'no_charge' | 'reschedule';

export const INTERRUPT_HANDLINGS: { value: InterruptHandling; label: string }[] = [
  { value: 'full_charge', label: 'Full charge' },
  { value: 'no_charge', label: 'No charge' },
  // { value: 'reschedule', label: 'Reschedule (no charge)' },  // disabled — see header note
];

// Every handling has its own short reason list. "Other" is always available
// and forces the Notes field to be required so the narrative is captured.
// Reason codes are namespaced so e.g. a no_charge "other" can't be confused
// with a full_charge "other" in reporting.
export const INTERRUPT_REASON_OTHER = 'other';

// Customer-complaint categories — the reason an interrupt happened. Aligned 1:1
// with the Incidents module's incident_type enum (complaint / service_quality /
// staff_issue / equipment_failure / accident) so an interrupt's reason
// cross-references a complaint type for reporting. "Other" stays available and
// forces the Notes field. full_charge and no_charge share this one set — whether
// the guest is charged (full) or waived (no charge) is the separate Handling
// decision, independent of which complaint category applies.
const COMPLAINT_REASONS: { value: string; label: string }[] = [
  { value: 'complaint', label: 'Complaint' },
  { value: 'service_quality', label: 'Service quality' },
  { value: 'staff_issue', label: 'Staff issue' },
  { value: 'equipment_failure', label: 'Equipment failure' },
  { value: 'accident', label: 'Accident' },
  { value: INTERRUPT_REASON_OTHER, label: 'Other (use Notes)' },
];

export const INTERRUPT_REASONS_BY_HANDLING: Record<
  InterruptHandling,
  { value: string; label: string }[]
> = {
  full_charge: COMPLAINT_REASONS,
  no_charge: COMPLAINT_REASONS,
  // Disabled handling (see header). Kept with its own list so re-enabling it
  // restores the reschedule-specific reasons rather than complaint categories.
  reschedule: [
    { value: 'rs_guest_emergency', label: 'Guest emergency, will return' },
    { value: 'rs_therapist_unavailable', label: 'Therapist unavailable, rebook later' },
    { value: 'rs_guest_paused', label: 'Service paused per guest request' },
    { value: INTERRUPT_REASON_OTHER, label: 'Other (use Notes)' },
  ],
};

/** Flat list of every valid (handling, reason_code) pair — used by the server
 *  Zod schema to refuse a code that doesn't belong to the picked handling. */
export const INTERRUPT_REASON_CODES_BY_HANDLING: Record<InterruptHandling, string[]> =
  Object.fromEntries(
    Object.entries(INTERRUPT_REASONS_BY_HANDLING).map(([h, list]) => [h, list.map((r) => r.value)]),
  ) as Record<InterruptHandling, string[]>;

/** Resolve a reason code to its human label for storing on the row alongside
 *  the code (legacy `interruption_reason` field and the Change History tab
 *  both read this label so the UI keeps showing "Guest dissatisfaction"
 *  without a join). */
export function interruptReasonLabel(handling: InterruptHandling, code: string): string {
  return INTERRUPT_REASONS_BY_HANDLING[handling]?.find((r) => r.value === code)?.label ?? code;
}
