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
// A Manila wall-clock timestamp for `day` at `min` minutes past midnight.
function makeIso(day: string, min: number): string {
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');
  return `${day}T${hh}:${mm}:00+08:00`;
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
  const { data: rr } = await supabase
    .from('reservation_resources')
    .select('reservation:reservations ( id, status, desired_service_start, desired_service_end, deleted_at )')
    .eq('resource_id', bedId);
  for (const row of rr ?? []) {
    const r = one(row.reservation) as { id: string; status: string; desired_service_start: string; desired_service_end: string; deleted_at: string | null } | null;
    if (!r || r.deleted_at || r.status !== 'confirmed') continue;
    if (exclude.reservationId && r.id === exclude.reservationId) continue;
    if (datePHT(r.desired_service_start) !== day) continue;
    if (overlaps(startMin, endMin, isoMinPHT(r.desired_service_start), isoMinPHT(r.desired_service_end))) return true;
  }
  const { data: oi } = await supabase
    .from('order_items')
    .select('id, status, scheduled_start, service_start, slot_start, actual_start, actual_end, duration_minutes, order:orders!order_items_order_id_fkey ( service_date )')
    .eq('resource_id', bedId)
    .in('status', ['scheduled', 'in_service']);
  for (const it of oi ?? []) {
    if (one(it.order)?.service_date !== day) continue;
    if (exclude.itemId && it.id === exclude.itemId) continue;
    const startIso = it.actual_start ?? it.scheduled_start ?? it.service_start ?? it.slot_start;
    if (!startIso) continue;
    const s = isoMinPHT(startIso);
    const e = it.actual_end ? isoMinPHT(it.actual_end) : s + (it.duration_minutes ?? 60);
    if (overlaps(startMin, endMin, s, e)) return true;
  }
  return false;
}

const bedNum = (name: string): number => { const m = name.match(/(\d+)/); return m ? Number(m[1]) : 9999; };

// For a group (pax>1) dragged onto a bed: keep that bed as the anchor and add the
// nearest free beds (same type, same zone + consecutive numbers preferred) so the
// whole group stays on `pax` beds. Returns [anchor, ...others] — anchor always
// included; fewer than pax if not enough are free.
async function pickGroupBeds(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  branchId: string,
  categoryIds: string[],
  anchorBedId: string,
  pax: number,
  day: string,
  startMin: number,
  endMin: number,
  reservationId: string,
): Promise<string[]> {
  if (pax <= 1) return [anchorBedId];
  const { data: cats } = await supabase.from('service_categories').select('required_resource_type').in('id', categoryIds);
  const types = [...new Set((cats ?? []).map((c) => c.required_resource_type).filter(Boolean) as string[])];
  const { data: resources } = await supabase
    .from('resources').select('id, resource_name, resource_type, location_zone')
    .eq('branch_id', branchId).eq('status', 'active');
  const all = (resources ?? []).map((r) => ({ id: r.id, num: bedNum(r.resource_name), type: r.resource_type, zone: r.location_zone ?? '' }));
  const anchor = all.find((b) => b.id === anchorBedId);
  const sameType = (b: { type: string | null }) => (types.length ? !!b.type && types.includes(b.type) : anchor ? b.type === anchor.type : true);
  const candidates: { id: string; num: number; zone: string }[] = [];
  for (const b of all) {
    if (b.id === anchorBedId || !sameType(b)) continue;
    if (await bedHasConflict(supabase, b.id, day, startMin, endMin, { reservationId })) continue;
    candidates.push({ id: b.id, num: b.num, zone: b.zone });
  }
  candidates.sort((a, b) => {
    const za = anchor && a.zone === anchor.zone ? 0 : 1;
    const zb = anchor && b.zone === anchor.zone ? 0 : 1;
    if (za !== zb) return za - zb;
    const da = anchor ? Math.abs(a.num - anchor.num) : a.num;
    const db = anchor ? Math.abs(b.num - anchor.num) : b.num;
    return da - db;
  });
  return [anchorBedId, ...candidates.slice(0, pax - 1).map((c) => c.id)];
}

const placeSchema = z.object({
  reservation_id: z.string().uuid(),
  bed_id: z.string().uuid(),
  start_min: z.number().int().min(0).max(1439),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // The bed the dragged block currently sits on (a group's bed). When set and the
  // booking has several beds, only this one moves; the rest stay put.
  from_bed: z.string().uuid().nullable().optional(),
});

/**
 * Drag a reservation onto a bed's time slot: pin that bed, set the desired
 * window to [start, start+duration], and commit it (confirmed, on-site). Keeps
 * the original span length. Rejects if the bed is already taken in that window.
 */
export async function placeReservationOnBed(input: unknown): Promise<ActionResult> {
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { reservation_id, bed_id, start_min, day, from_bed } = parsed.data;
  const supabase = await createAuditedClient();

  const { data: r } = await supabase
    .from('reservations')
    .select('branch_id, status, desired_service_start, desired_service_end, pax, reservation_service_categories ( service_category_id ), reservation_resources ( resource_id )')
    .eq('id', reservation_id)
    .single();
  if (!r) return { ok: false, error: 'Reservation not found' };
  if (!(await canAccessBranch(r.branch_id))) return { ok: false, error: 'No access to this branch' };

  const spanMs = Date.parse(r.desired_service_end) - Date.parse(r.desired_service_start);
  const durationMin = spanMs > 0 ? Math.round(spanMs / 60000) : 60;
  const endMin = start_min + durationMin;
  if (await bedHasConflict(supabase, bed_id, day, start_min, endMin, { reservationId: reservation_id })) {
    return { ok: false, error: 'That bed is already booked for this time' };
  }
  // Resource-type guard — Hair Salon onto Bed #1 (massage_bed) etc. used to
  // sail through because the conflict check is purely time-based.
  {
    const categoryIds = (r.reservation_service_categories ?? []).map((x) => x.service_category_id);
    const compat = await assertBedsMatchCategories([bed_id], categoryIds);
    if (!compat.ok) return { ok: false, error: compat.error };
  }

  const startIso = makeIso(day, start_min);
  const endIso = new Date(Date.parse(startIso) + durationMin * 60000).toISOString();
  const currentPins = (r.reservation_resources ?? []).map((x) => x.resource_id);

  // Single-bed move: dragging ONE bed of a group onto a free bed swaps just that
  // bed (the rest stay); the booking's time still follows the drop (one shared
  // window). Lets you peel one guest off to a freed bed, e.g. E → C.
  if (currentPins.length > 1 && from_bed && currentPins.includes(from_bed)) {
    if (bed_id !== from_bed && currentPins.includes(bed_id)) {
      return { ok: false, error: 'That bed is already used by this booking' };
    }
    const newPins = currentPins.map((b) => (b === from_bed ? bed_id : b));
    for (const b of newPins) {
      if (b === bed_id) continue; // the dropped bed was already conflict-checked
      if (await bedHasConflict(supabase, b, day, start_min, endMin, { reservationId: reservation_id })) {
        return { ok: false, error: 'Another of the group’s beds clashes at this time' };
      }
    }
    const upd = await supabase
      .from('reservations')
      .update({ desired_service_start: startIso, desired_service_end: endIso, status: 'confirmed', service_location_type: 'on_site' })
      .eq('id', reservation_id);
    if (upd.error) return { ok: false, error: upd.error.message };
    await supabase.from('reservation_resources').delete().eq('reservation_id', reservation_id);
    const ins = await supabase.from('reservation_resources').insert(newPins.map((resource_id) => ({ reservation_id, resource_id })));
    if (ins.error) return { ok: false, error: ins.error.message };
    revalidatePath('/shift-schedule');
    return { ok: true };
  }

  // Otherwise (first placement / single guest / whole-group move): anchor on the
  // dropped bed and (re)assign one bed per guest.
  const upd = await supabase
    .from('reservations')
    .update({ desired_service_start: startIso, desired_service_end: endIso, status: 'confirmed', service_location_type: 'on_site' })
    .eq('id', reservation_id);
  if (upd.error) return { ok: false, error: upd.error.message };

  const categoryIds = (r.reservation_service_categories ?? []).map((x) => x.service_category_id);
  const beds = await pickGroupBeds(supabase, r.branch_id, categoryIds, bed_id, r.pax ?? 1, day, start_min, endMin, reservation_id);
  await supabase.from('reservation_resources').delete().eq('reservation_id', reservation_id);
  const ins = await supabase.from('reservation_resources').insert(beds.map((resource_id) => ({ reservation_id, resource_id })));
  if (ins.error) return { ok: false, error: ins.error.message };

  revalidatePath('/shift-schedule');
  return { ok: true };
}

const moveSchema = z.object({
  item_id: z.string().uuid(),
  bed_id: z.string().uuid(),
  start_min: z.number().int().min(0).max(1439),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Drag a not-yet-started (scheduled) order item to a new bed/time. Once a
 * service is in-service or done its bed is locked, so this only moves scheduled
 * items. Rejects on a bed/time clash.
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
  if (it.status !== 'scheduled') return { ok: false, error: 'Service already started — its bed is locked' };
  const branchId = one(it.order)?.branch_id;
  if (!branchId || !(await canAccessBranch(branchId))) return { ok: false, error: 'No access to this branch' };

  const durationMin = it.duration_minutes ?? 60;
  const endMin = start_min + durationMin;
  if (await bedHasConflict(supabase, bed_id, day, start_min, endMin, { itemId: item_id })) {
    return { ok: false, error: 'That bed is already booked for this time' };
  }
  // Resource-type guard for the same reason as placeReservationOnBed.
  if (it.service_item_id) {
    const compat = await assertBedMatchesServiceItem(bed_id, it.service_item_id);
    if (!compat.ok) return { ok: false, error: compat.error };
  }

  const startIso = makeIso(day, start_min);
  const endIso = new Date(Date.parse(startIso) + durationMin * 60000).toISOString();
  const { error } = await supabase
    .from('order_items')
    .update({ resource_id: bed_id, scheduled_start: startIso, slot_start: startIso, slot_end: endIso })
    .eq('id', item_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/shift-schedule');
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
  revalidatePath('/shift-schedule');
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
  revalidatePath('/shift-schedule');
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
  revalidatePath('/shift-schedule');
  return { ok: true };
}
