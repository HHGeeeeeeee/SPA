'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { canAccessBranch } from '@/lib/branch-access';
import { currentSession, isManager } from '@/lib/auth';
import { assertBedsMatchCategories, assertBedMatchesServiceItem } from '@/lib/resource-compatibility';

export type ActionResult = { ok: true } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// Minute-of-day for an ISO timestamp, read in Manila wall time.
function isoMinPHT(iso: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
function datePHT(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
// A Manila wall-clock timestamp for `day` at `min` minutes past midnight. On a
// past-midnight board, `min` can exceed 1439 (e.g. 1470 = 00:30 the next clock
// day); roll the date and wrap the clock so the timestamp stays valid.
function makeIso(day: string, min: number): string {
  const d = min >= 1440 ? dayPlusOne(day) : day;
  const clock = ((min % 1440) + 1440) % 1440;
  const hh = String(Math.floor(clock / 60)).padStart(2, '0');
  const mm = String(clock % 60).padStart(2, '0');
  return `${d}T${hh}:${mm}:00+08:00`;
}
// 'YYYY-MM-DD' + 1 calendar day (UTC math, tz-agnostic for the date string).
function dayPlusOne(day: string): string {
  const [y, m, dd] = day.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd + 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

// Is `bedId` already taken on `day` during [startMin, endMin)? Checks confirmed
// pinned reservations and live/scheduled order items on that bed (excluding self).
async function bedHasConflict(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  bedId: string,
  day: string,
  startMin: number,
  endMin: number,
  exclude: { reservationId?: string; itemId?: string },
): Promise<boolean> {
  // Bookings are order_items now (the reservations table is retired), so a bed's
  // occupancy comes entirely from scheduled/in-service order items on that bed.
  const { data: oi } = await supabase
    .from('order_items')
    .select('id, status, scheduled_start, slot_start, slot_end, duration_minutes, order:orders!order_items_order_id_fkey ( service_date )')
    .eq('resource_id', bedId)
    .in('status', ['draft', 'in_service']);
  for (const it of oi ?? []) {
    if (one(it.order)?.service_date !== day) continue;
    if (exclude.itemId && it.id === exclude.itemId) continue;
    const startIso = it.slot_start ?? it.scheduled_start;
    if (!startIso) continue;
    // Normalise to the board's minute axis. startMin/endMin can exceed 1439 on a
    // past-midnight board (00:30 next clock day = 1470), but isoMinPHT only ever
    // returns a 0–1439 wall-clock minute. A stored slot whose calendar date is
    // the day *after* this business day is a past-midnight slot, so shift it by
    // +1440 — otherwise a 00:30 booking reads as 30 and never overlaps a 1470
    // placement (and a service spanning midnight would have end < start).
    const s = isoMinPHT(startIso) + (datePHT(startIso) !== day ? 1440 : 0);
    const e = it.slot_end
      ? isoMinPHT(it.slot_end) + (datePHT(it.slot_end) !== day ? 1440 : 0)
      : s + (it.duration_minutes ?? 60);
    if (overlaps(startMin, endMin, s, e)) return true;
  }
  return false;
}

const moveSchema = z.object({
  item_id: z.string().uuid(),
  bed_id: z.string().uuid(),
  start_min: z.number().int().min(0).max(2879),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Drag a not-yet-started order item onto a bed/time. Works for both `unassigned`
 * (a booking in the unallocated rail — placing it onto a bed promotes it to
 * `scheduled`) and an already-`scheduled` line being re-timed/moved. Once a
 * service is in-service or done its bed is locked. Rejects on a bed/time clash.
 */
export async function moveScheduledOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { item_id, bed_id, start_min, day } = parsed.data;
  const supabase = await createAuditedClient();

  const { data: it } = await supabase
    .from('order_items')
    .select('status, duration_minutes, service_item_id, order:orders!order_items_order_id_fkey ( branch_id )')
    .eq('id', item_id)
    .single();
  if (!it) return { ok: false, error: 'Order item not found' };
  if (it.status !== 'draft') return { ok: false, error: 'Service already started — its bed is locked' };
  const branchId = one(it.order)?.branch_id;
  if (!branchId || !(await canAccessBranch(branchId))) return { ok: false, error: 'No access to this branch' };

  const durationMin = it.duration_minutes ?? 60;
  const endMin = start_min + durationMin;
  if (await bedHasConflict(supabase, bed_id, day, start_min, endMin, { itemId: item_id })) {
    return { ok: false, error: 'That bed is already booked for this time' };
  }
  // Resource-type guard for the same reason as placeReservationOnBed. (A deferred
  // line with no concrete service yet skips this — the category check belongs to
  // the picker; nothing to type-match until the service is chosen.)
  if (it.service_item_id) {
    const compat = await assertBedMatchesServiceItem(bed_id, it.service_item_id);
    if (!compat.ok) return { ok: false, error: compat.error };
  }

  const startIso = makeIso(day, start_min);
  const endIso = new Date(Date.parse(startIso) + durationMin * 60000).toISOString();
  // Placing on a bed makes it scheduled (it now sits on the board axis).
  const { error } = await supabase
    .from('order_items')
    .update({ resource_id: bed_id, scheduled_start: startIso, slot_start: startIso, slot_end: endIso })
    .eq('id', item_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

// Is `therapistId` already on another booking on `day` during [startMin, endMin)?
// Mirrors bedHasConflict but keyed on the therapist. A therapist-assigned-but-
// bedless booking keeps status 'draft', so that's included alongside
// scheduled / in-service lines.
async function therapistHasConflict(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  therapistId: string,
  day: string,
  startMin: number,
  endMin: number,
  excludeItemId: string,
): Promise<boolean> {
  const { data: oi } = await supabase
    .from('order_items')
    .select('id, status, scheduled_start, slot_start, slot_end, duration_minutes, order:orders!order_items_order_id_fkey ( service_date )')
    .eq('therapist_id', therapistId)
    .in('status', ['draft', 'in_service']);
  for (const it of oi ?? []) {
    if (one(it.order)?.service_date !== day) continue;
    if (it.id === excludeItemId) continue;
    const startIso = it.slot_start ?? it.scheduled_start;
    if (!startIso) continue;
    const s = isoMinPHT(startIso) + (datePHT(startIso) !== day ? 1440 : 0);
    const e = it.slot_end
      ? isoMinPHT(it.slot_end) + (datePHT(it.slot_end) !== day ? 1440 : 0)
      : s + (it.duration_minutes ?? 60);
    if (overlaps(startMin, endMin, s, e)) return true;
  }
  return false;
}

const assignSchema = z.object({
  item_id: z.string().uuid(),
  therapist_id: z.string().uuid(),
  start_min: z.number().int().min(0).max(2879),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Pre-assign a therapist to a not-yet-started booking by dragging it onto that
 * person's row on the People board (or re-timing a line already on their row).
 * Sets therapist_id + the booked time; the bed (resource_id) is independent and
 * untouched — a therapist-assigned line with no bed stays `unassigned` and rides
 * the Station board's "needs a bed" rail. Rejects on a therapist time clash.
 */
export async function assignTherapistToOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { item_id, therapist_id, start_min, day } = parsed.data;
  const supabase = await createAuditedClient();

  const { data: it } = await supabase
    .from('order_items')
    .select('status, duration_minutes, order:orders!order_items_order_id_fkey ( branch_id )')
    .eq('id', item_id)
    .single();
  if (!it) return { ok: false, error: 'Order item not found' };
  if (it.status !== 'draft') return { ok: false, error: 'Service already started — assignment is locked' };
  const branchId = one(it.order)?.branch_id;
  if (!branchId || !(await canAccessBranch(branchId))) return { ok: false, error: 'No access to this branch' };

  const durationMin = it.duration_minutes ?? 60;
  const endMin = start_min + durationMin;
  if (await therapistHasConflict(supabase, therapist_id, day, start_min, endMin, item_id)) {
    return { ok: false, error: 'That therapist is already booked for this time' };
  }

  const startIso = makeIso(day, start_min);
  const endIso = new Date(Date.parse(startIso) + durationMin * 60000).toISOString();
  const { error } = await supabase
    .from('order_items')
    .update({ therapist_id, scheduled_start: startIso, slot_start: startIso, slot_end: endIso })
    .eq('id', item_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

const unassignSchema = z.object({
  item_id: z.string().uuid(),
  // 'station' clears the bed/station (the Station board's Unassign); 'therapist'
  // clears the therapist (the People board's). The other assignment is kept.
  target: z.enum(['station', 'therapist']),
});

/**
 * Clear one assignment off a not-yet-started booking — its bed/station OR its
 * therapist, never both — sending it back to that board's unallocated rail while
 * leaving the other assignment and the booked time intact. Started services are
 * locked, so only `draft` lines can be unassigned.
 */
export async function unassignOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = unassignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { item_id, target } = parsed.data;
  const supabase = await createAuditedClient();

  const { data: it } = await supabase
    .from('order_items')
    .select('status, therapist_id, resource_id, order:orders!order_items_order_id_fkey ( branch_id )')
    .eq('id', item_id)
    .single();
  if (!it) return { ok: false, error: 'Order item not found' };
  if (it.status !== 'draft') return { ok: false, error: 'Service already started — assignment is locked' };
  const branchId = one(it.order)?.branch_id;
  if (!branchId || !(await canAccessBranch(branchId))) return { ok: false, error: 'No access to this branch' };

  if (target === 'station' && it.resource_id == null) return { ok: true }; // nothing to clear
  if (target === 'therapist' && it.therapist_id == null) return { ok: true };
  const patch = target === 'station' ? { resource_id: null } : { therapist_id: null };

  const { error } = await supabase.from('order_items').update(patch).eq('id', item_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

const schema = z.object({
  employee_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  shift_date: z.string().min(1),
  shift_type: z.enum(['regular', 'cross_branch', 'on_call', 'off', 'leave']),
  shift_start: z.string().optional().nullable(),
  shift_end: z.string().optional().nullable(),
  leave_type: z.enum(['sick', 'vacation', 'personal', 'unpaid']).optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

const TIMED = ['regular', 'cross_branch', 'on_call'];

// One shift per (employee, date, branch) cell: replace whatever's there.
export async function setShift(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  // Roster edits are a manager task, and only for branches the user can access.
  if (!isManager(await currentSession())) return { ok: false, error: 'Manager permission required to edit the roster' };
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };

  const timed = TIMED.includes(d.shift_type);
  if (timed && (!d.shift_start || !d.shift_end)) {
    return { ok: false, error: 'Start and end time are required for this shift type' };
  }
  if (timed && d.shift_end! <= d.shift_start!) {
    return { ok: false, error: 'End time must be after start time' };
  }
  if (d.shift_type === 'leave' && !d.leave_type) {
    return { ok: false, error: 'Pick a leave type' };
  }

  const supabase = await createAuditedClient();

  await supabase
    .from('employee_shifts')
    .delete()
    .eq('employee_id', d.employee_id)
    .eq('branch_id', d.branch_id)
    .eq('shift_date', d.shift_date);

  const { error } = await supabase.from('employee_shifts').insert({
    employee_id: d.employee_id,
    branch_id: d.branch_id,
    shift_date: d.shift_date,
    shift_type: d.shift_type,
    shift_start: timed ? d.shift_start : null,
    shift_end: timed ? d.shift_end : null,
    leave_type: d.shift_type === 'leave' ? d.leave_type : null,
    note: d.note || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

const bulkSchema = z.object({
  branch_id: z.string().uuid(),
  employee_ids: z.array(z.string().uuid()).min(1, 'Pick at least one employee'),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1, 'Pick at least one day'),
  shift_type: z.enum(['regular', 'cross_branch', 'on_call', 'off', 'leave']),
  shift_start: z.string().optional().nullable(),
  shift_end: z.string().optional().nullable(),
  leave_type: z.enum(['sick', 'vacation', 'personal', 'unpaid']).optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

/**
 * Apply one shift to many employees × many dates at once (replaces whatever's
 * in each cell) — so a week's roster isn't set cell-by-cell.
 */
export async function bulkSetShifts(input: unknown): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  if (!isManager(await currentSession())) return { ok: false, error: 'Manager permission required to edit the roster' };
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };

  const timed = TIMED.includes(d.shift_type);
  if (timed && (!d.shift_start || !d.shift_end)) return { ok: false, error: 'Start and end time are required for this shift type' };
  if (timed && d.shift_end! <= d.shift_start!) return { ok: false, error: 'End time must be after start time' };
  if (d.shift_type === 'leave' && !d.leave_type) return { ok: false, error: 'Pick a leave type' };

  const supabase = await createAuditedClient();
  // One shift per (employee, date, branch): clear the targeted cells first.
  const del = await supabase
    .from('employee_shifts')
    .delete()
    .eq('branch_id', d.branch_id)
    .in('employee_id', d.employee_ids)
    .in('shift_date', d.dates);
  if (del.error) return { ok: false, error: del.error.message };

  const rows = d.employee_ids.flatMap((employee_id) =>
    d.dates.map((shift_date) => ({
      employee_id,
      branch_id: d.branch_id,
      shift_date,
      shift_type: d.shift_type,
      shift_start: timed ? d.shift_start : null,
      shift_end: timed ? d.shift_end : null,
      leave_type: d.shift_type === 'leave' ? d.leave_type : null,
      note: d.note || null,
    })),
  );
  const ins = await supabase.from('employee_shifts').insert(rows);
  if (ins.error) return { ok: false, error: ins.error.message };
  revalidatePath('/calendar');
  return { ok: true, count: rows.length };
}

export async function clearShift(
  employeeId: string,
  branchId: string,
  shiftDate: string,
): Promise<ActionResult> {
  if (!isManager(await currentSession())) return { ok: false, error: 'Manager permission required to edit the roster' };
  if (!(await canAccessBranch(branchId))) return { ok: false, error: 'No access to this branch' };
  const supabase = await createAuditedClient();
  const { error } = await supabase
    .from('employee_shifts')
    .delete()
    .eq('employee_id', employeeId)
    .eq('branch_id', branchId)
    .eq('shift_date', shiftDate);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}
