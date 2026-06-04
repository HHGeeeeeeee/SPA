'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { nextOrderNo } from '@/lib/order-no';
import { canAccessBranch } from '@/lib/branch-access';
import { currentSession } from '@/lib/auth';
import { canPerformAny, matchesGender } from '@/lib/therapist-availability';
import { addOrderItem } from '@/app/(dashboard)/sales-orders/actions';
import { assertBedsMatchCategories } from '@/lib/resource-compatibility';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const schema = z.object({
  branch_id: z.string().uuid(),
  // The reservation's customer source (WALK-IN, a hotel, ENGO, …). Drives the
  // billing destination and whether a guest phone is required.
  source_id: z.string().uuid(),
  // One reservation can need several service types (e.g. hair + massage).
  service_category_ids: z.array(z.string().uuid()).min(1, 'Pick at least one service type'),
  guest_name: z.string().min(1).max(120),
  guest_phone: z.string().max(40).optional().nullable(),
  pax: z.coerce.number().int().min(1).max(50).default(1),
  gender_preference: z.string().max(20).optional().nullable(),
  desired_service_start: z.string().min(1),
  desired_service_end: z.string().min(1),
  service_location_type: z.enum(['on_site', 'external_hotel']).default('on_site'),
  note: z.string().max(500).optional().nullable(),
  // Explicit staff bed override (hybrid). Empty = let the system decide.
  resource_ids: z.array(z.string().uuid()).optional().default([]),
  // Group wants to sit together → auto-assign adjacent beds when no override.
  seat_together: z.boolean().optional().default(false),
  // Walk-in: guest is present → create as confirmed (established), not pending.
  confirmed: z.boolean().optional().default(false),
  // Optional specific service (within a chosen category). Null = decide later.
  service_item_id: z.string().uuid().optional().nullable(),
  // Back-link to the interrupted order_item being made up. Set by the
  // Pending Reschedules flow; null on every other path. When set we ALSO
  // mark the source line `reschedule_fulfilled_at` so it drops off the
  // pending list — creating the make-up reservation IS the resolution.
  rescheduled_from_order_item_id: z.string().uuid().optional().nullable(),
});

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// Replace a reservation's service-category set (the multi-select source of truth).
// Retirement path: a booking IS a draft order + unassigned order_items, with no
// reservation row. Combines what createReservation + convertReservationToOrder
// used to do. One draft order; one order_customer per pax (gender carried on the
// customer); one unassigned line per guest holding the primary category + booked
// time + pinned bed. Concrete service + price are decided later in the workspace.
export async function createBooking(input: unknown): Promise<ActionResult<{ orderId: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  if (new Date(d.desired_service_end) <= new Date(d.desired_service_start)) {
    return { ok: false, error: 'End time must be after start time' };
  }
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };
  const supabase = await createAuditedClient();

  const { data: source } = await supabase
    .from('customer_sources')
    .select('phone_required, default_billing_to_id, default_discount_class_id')
    .eq('id', d.source_id)
    .maybeSingle();
  if (!source) return { ok: false, error: 'Customer source not found' };
  if (source.phone_required && !d.guest_phone?.trim()) {
    return { ok: false, error: 'A guest phone is required for this source' };
  }

  // Resolve beds: explicit override, else seat-together auto-assign, else none.
  const pinned = await resolveEffectiveBeds({
    branchId: d.branch_id, resourceIds: d.resource_ids, seatTogether: d.seat_together,
    categoryIds: d.service_category_ids, pax: d.pax,
    start: d.desired_service_start, end: d.desired_service_end,
    locationType: d.service_location_type, excludeReservationId: null,
  });
  if (!pinned.ok) return { ok: false, error: pinned.error };

  // Duration: the chosen service's, else 60 (a category-only booking).
  let durationMin = 60;
  if (d.service_item_id) {
    const { data: svc } = await supabase.from('service_items').select('duration_minutes').eq('id', d.service_item_id).maybeSingle();
    durationMin = svc?.duration_minutes ?? 60;
  }

  const serviceDate = d.desired_service_start.slice(0, 10);
  const order_no = await nextOrderNo(supabase, serviceDate);
  const { data: order, error: oe } = await supabase
    .from('orders')
    .insert({
      order_no,
      branch_id: d.branch_id,
      source_id: d.source_id,
      billing_to_id: source.default_billing_to_id ?? null,
      // order_type's CHECK allows walk_in/reservation/package_use/stored_value/
      // external — 'reservation' is the booking-origin value (kept until the
      // enum is renamed in the final cleanup).
      order_type: 'reservation',
      service_location_type: d.service_location_type,
      service_date: serviceDate,
      note: d.note || null,
      status: 'draft',
    })
    .select('id')
    .single();
  if (oe || !order) return { ok: false, error: oe?.message ?? 'Could not create booking' };

  // One order_customer per pax (first keeps the contact; gender preference rides
  // on the customer so service start can still match a therapist's gender).
  const pax = Math.max(1, d.pax);
  const { data: customers, error: ce } = await supabase
    .from('order_customers')
    .insert(
      Array.from({ length: pax }, (_, i) => ({
        order_id: order.id,
        customer_name: i === 0 ? d.guest_name : `Guest ${i + 1}`,
        customer_phone: i === 0 ? (d.guest_phone || null) : null,
        gender: d.gender_preference || null,
        seq_no: i + 1,
      })),
    )
    .select('id, seq_no');
  if (ce) return { ok: false, error: ce.message };
  const sortedCustomers = [...(customers ?? [])].sort((a, b) => a.seq_no - b.seq_no);

  // Discount class: the source's default, else DIS-00 (no discount).
  let discountClassId = source.default_discount_class_id ?? null;
  if (!discountClassId) {
    const { data: dis0 } = await supabase.from('discount_classes').select('id').eq('code', 'DIS-00').maybeSingle();
    discountClassId = dis0?.id ?? null;
  }
  if (!discountClassId) return { ok: false, error: 'No default discount class configured' };

  // One unassigned line per guest: primary category + booked time + (pinned) bed.
  const beds = pinned.ids;
  const primaryCategory = d.service_category_ids[0];
  for (let i = 0; i < sortedCustomers.length; i++) {
    const bedId = beds[i] ?? null;
    const { error: ie } = await supabase.from('order_items').insert({
      order_id: order.id,
      order_customer_id: sortedCustomers[i].id,
      service_category_id: primaryCategory,
      service_item_id: d.service_item_id ?? null,
      scheduled_start: d.desired_service_start,
      duration_minutes: durationMin,
      resource_id: bedId,
      external_room_no: null,
      discount_class_id: discountClassId,
      discount_amount_cents: 0,
      list_price_cents: null,
      final_amount_cents: null,
      // On a bed ⇒ scheduled (sits on the board); else unassigned (rail).
      status: bedId ? 'scheduled' : 'unassigned',
    });
    if (ie) return { ok: false, error: ie.message };
  }

  // Booking made → close out a pending reschedule, if this was one.
  if (d.rescheduled_from_order_item_id) {
    await supabase
      .from('order_items')
      .update({ reschedule_fulfilled_at: new Date().toISOString() })
      .eq('id', d.rescheduled_from_order_item_id)
      .eq('interruption_handling', 'reschedule')
      .is('reschedule_fulfilled_at', null);
    revalidatePath('/sales-orders/reschedules');
  }

  revalidatePath('/calendar');
  revalidatePath('/sales-orders');
  return { ok: true, data: { orderId: order.id } };
}

// Bed/station capacity for a branch + time window, per resource type. Demand is
// PAX-based and concurrent: each overlapping reservation contributes its pax to
// every resource type it needs (conservative for sequential flows). Used by the
// reservation form to warn before overbooking. Soft check — never blocks.
export async function getReservationAvailability(input: {
  branch_id: string;
  start: string;
  end: string;
  exclude_id?: string | null;
}): Promise<ActionResult<{ byType: Record<string, { capacity: number; used: number }> }>> {
  if (!input.branch_id || !input.start || !input.end) return { ok: false, error: 'Missing input' };
  const supabase = await createAuditedClient();

  // Capacity = active resources of each type at the branch.
  const { data: resources } = await supabase
    .from('resources')
    .select('resource_type')
    .eq('branch_id', input.branch_id)
    .eq('status', 'active');
  const capacity: Record<string, number> = {};
  for (const r of resources ?? []) {
    if (r.resource_type) capacity[r.resource_type] = (capacity[r.resource_type] ?? 0) + 1;
  }

  // Overlapping order-item bookings (scheduled or live) → demand per resource
  // type. One line = one guest-service = one unit of demand for its category type.
  const startMs = Date.parse(input.start);
  const endMs = Date.parse(input.end);
  const { data: overlapping } = await supabase
    .from('order_items')
    .select('scheduled_start, actual_start, actual_end, duration_minutes, category:service_categories ( required_resource_type ), order:orders!order_items_order_id_fkey ( branch_id )')
    .in('status', ['scheduled', 'in_service', 'service_completed', 'interrupted']);
  const used: Record<string, number> = {};
  for (const it of overlapping ?? []) {
    if (one(it.order)?.branch_id !== input.branch_id) continue;
    const startIso = it.actual_start ?? it.scheduled_start;
    if (!startIso) continue;
    const s = Date.parse(startIso);
    const e = it.actual_end ? Date.parse(it.actual_end) : s + (it.duration_minutes ?? 60) * 60000;
    if (!(s < endMs && startMs < e)) continue;
    const t = one(it.category)?.required_resource_type;
    if (t) used[t] = (used[t] ?? 0) + 1;
  }

  const byType: Record<string, { capacity: number; used: number }> = {};
  for (const t of new Set([...Object.keys(capacity), ...Object.keys(used)])) {
    byType[t] = { capacity: capacity[t] ?? 0, used: used[t] ?? 0 };
  }
  return { ok: true, data: { byType } };
}


// Resource IDs unavailable in [start,end): occupied by a live order or pinned by
// another confirmed reservation. A bed's occupancy is the service window widened
// by prep_before_minutes (before) + cleanup_after_minutes (after), so back-to-back
// bookings keep a turnover gap. The DB window is widened by BUF so a
// buffered-but-not-raw overlap isn't filtered out before the exact JS check.
const OCCUPANCY_BUF_MS = 60 * 60_000;
async function computeBusyResourceIds(
  branchId: string,
  start: string,
  end: string,
  excludeReservationId?: string | null,
): Promise<Set<string>> {
  void excludeReservationId; // legacy param (reservations retired); create has no self line to exclude
  const supabase = await createAuditedClient();
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const busy = new Set<string>();

  // A booked OR live order item on a bed holds it: a `scheduled` line uses its
  // planned time, a started line uses actual. Window widened by prep + cleanup.
  // (Bookings are order_items now — this is the whole occupancy picture.)
  const { data: items } = await supabase
    .from('order_items')
    .select('resource_id, scheduled_start, actual_start, actual_end, duration_minutes, service:service_items ( prep_before_minutes, cleanup_after_minutes ), order:orders!order_items_order_id_fkey ( branch_id )')
    .not('resource_id', 'is', null)
    .in('status', ['scheduled', 'in_service', 'service_completed', 'interrupted']);
  for (const it of items ?? []) {
    if (one(it.order)?.branch_id !== branchId || !it.resource_id) continue;
    const startIso = it.actual_start ?? it.scheduled_start;
    if (!startIso) continue;
    const svc = one(it.service);
    const s0 = Date.parse(startIso);
    const e0 = it.actual_end ? Date.parse(it.actual_end) : s0 + (it.duration_minutes ?? 60) * 60000;
    const s = s0 - (svc?.prep_before_minutes ?? 0) * 60000;
    const e = e0 + (svc?.cleanup_after_minutes ?? 0) * 60000;
    if (s < endMs && startMs < e) busy.add(it.resource_id);
  }
  return busy;
}

// Earliest time `pax` stations of a type AND `pax` therapists are both free for
// `durationMin` — used by the reservation form's "Next available" walk-in helper.
// Beds consider live order occupancy (incl. cleanup) + confirmed holds; therapists
// must be on a working shift at the branch today and not mid-service. Returns null
// start if it can't fit within ~24h.
export async function nextAvailableSlot(input: {
  branch_id: string;
  resource_type: string;
  pax: number;
  durationMin: number;
  gender?: string | null; // 'M' | 'F' — only count therapists of this gender
  service_category_id?: string | null; // count therapists who can do this category
  service_group?: string | null; // narrower: a specific service group within it
}): Promise<ActionResult<{ start: string | null; availableNow: boolean }>> {
  if (!input.branch_id || !input.resource_type) return { ok: false, error: 'Missing input' };
  const supabase = await createAuditedClient();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const phtDate = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}-${p.find((x) => x.type === 'day')!.value}`;
  };
  const phtMinOfDay = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
    return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
  };
  const hhmmToMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

  const durMin = Math.max(15, input.durationMin);
  const dur = durMin * 60_000;
  const now = Date.now();
  const today = phtDate(now);
  const lookback = new Date(now - 12 * 3600 * 1000).toISOString();
  const horizon = new Date(now + 24 * 3600 * 1000).toISOString();

  // --- Beds of the needed type ---
  const { data: resources } = await supabase
    .from('resources').select('id')
    .eq('branch_id', input.branch_id).eq('status', 'active').eq('resource_type', input.resource_type);
  const typeIds = (resources ?? []).map((r) => r.id);
  if (typeIds.length === 0) return { ok: false, error: 'No stations of this type at this branch' };
  if (input.pax > typeIds.length) return { ok: true, data: { start: null, availableNow: false } };

  // --- Therapist pool: on a working shift at this branch today (filtered to
  // therapist positions when those exist), with their shift windows. ---
  const { data: positions } = await supabase.from('positions').select('id, name');
  const therapistPos = new Set((positions ?? []).filter((p) => /massage|therap/i.test(p.name ?? '')).map((p) => p.id));
  const { data: shiftsToday } = await supabase
    .from('employee_shifts').select('employee_id, shift_start, shift_end')
    .eq('branch_id', input.branch_id).eq('shift_date', today).in('shift_type', ['regular', 'cross_branch', 'on_call']);
  let pool = (shiftsToday ?? []).map((s) => ({ id: s.employee_id, startMin: hhmmToMin(s.shift_start), endMin: hhmmToMin(s.shift_end) }));
  if (pool.length) {
    const poolIds = pool.map((p) => p.id);
    const { data: emps } = await supabase.from('employees').select('id, position_id, gender').in('id', poolIds);
    const meta = new Map((emps ?? []).map((e) => [e.id, e]));

    // Capability: a specific service_group if given, else all groups within the
    // chosen category. Match against each pool member's skills (canPerformAny).
    let groups = new Set<string>();
    if (input.service_group) {
      groups = new Set([input.service_group]);
    } else if (input.service_category_id) {
      const { data: catItems } = await supabase.from('service_items').select('service_group').eq('service_category_id', input.service_category_id);
      groups = new Set((catItems ?? []).map((i) => i.service_group).filter(Boolean) as string[]);
    }
    const capsByEmp = new Map<string, string[]>();
    if (groups.size > 0) {
      const { data: caps } = await supabase.from('employee_service_groups').select('employee_id, service_group').in('employee_id', poolIds);
      for (const c of caps ?? []) (capsByEmp.get(c.employee_id) ?? capsByEmp.set(c.employee_id, []).get(c.employee_id)!).push(c.service_group);
    }

    pool = pool.filter((p) => {
      const e = meta.get(p.id);
      if (therapistPos.size > 0 && !therapistPos.has(e?.position_id as string)) return false; // only therapists
      if (!matchesGender(e?.gender, input.gender)) return false; // gender preference
      if (groups.size > 0 && !canPerformAny(capsByEmp.get(p.id) ?? [], groups)) return false; // can perform the category
      return true;
    });
  }
  if (input.pax > pool.length) return { ok: true, data: { start: null, availableNow: false } };

  // Therapist occupancy today (busy while mid-service; no cleanup tail for people).
  const { data: titems } = await supabase
    .from('order_items')
    .select('therapist_id, actual_start, actual_end, duration_minutes, order:orders!order_items_order_id_fkey ( branch_id, service_date )')
    .not('actual_start', 'is', null).in('therapist_id', pool.map((p) => p.id))
    .gte('actual_start', lookback).lt('actual_start', horizon);
  const thBusy: { th: string; s: number; e: number }[] = [];
  for (const it of titems ?? []) {
    const o = one(it.order);
    if (o?.branch_id !== input.branch_id || o?.service_date !== today || !it.therapist_id) continue;
    const s = Date.parse(it.actual_start as string);
    thBusy.push({ th: it.therapist_id, s, e: it.actual_end ? Date.parse(it.actual_end) : s + (it.duration_minutes ?? 60) * 60_000 });
  }

  // --- Change-points: when a bed frees (order+cleanup / confirmed hold), when a
  // therapist finishes, and when a therapist's shift starts. ---
  const ends: number[] = [];
  const { data: items } = await supabase
    .from('order_items')
    .select('actual_start, actual_end, duration_minutes, resource_id, service:service_items ( cleanup_after_minutes ), order:orders!order_items_order_id_fkey ( branch_id )')
    .in('resource_id', typeIds).not('actual_start', 'is', null)
    .gte('actual_start', lookback).lt('actual_start', horizon);
  for (const it of items ?? []) {
    if (one(it.order)?.branch_id !== input.branch_id) continue;
    const s = Date.parse(it.actual_start as string);
    const e0 = it.actual_end ? Date.parse(it.actual_end) : s + (it.duration_minutes ?? 60) * 60_000;
    ends.push(e0 + (one(it.service)?.cleanup_after_minutes ?? 0) * 60_000);
  }
  for (const b of thBusy) ends.push(b.e);
  for (const p of pool) {
    if (p.startMin != null) ends.push(Date.parse(`${today}T${pad2(Math.floor(p.startMin / 60))}:${pad2(p.startMin % 60)}:00+08:00`));
  }

  const candidates = [...new Set([now, ...ends.filter((t) => t > now)])].sort((a, b) => a - b);
  for (const t of candidates) {
    const busy = await computeBusyResourceIds(input.branch_id, new Date(t).toISOString(), new Date(t + dur).toISOString(), null);
    const freeBeds = typeIds.filter((id) => !busy.has(id)).length;
    if (freeBeds < input.pax) continue;
    // A therapist is free if their shift covers [t, t+dur] and they're not busy.
    const tMin = phtMinOfDay(t);
    const tEndMin = tMin + durMin;
    const freeTh = pool.filter((p) =>
      p.startMin != null && p.endMin != null && p.startMin <= tMin && p.endMin >= tEndMin &&
      !thBusy.some((b) => b.th === p.id && b.s < t + dur && t < b.e),
    ).length;
    if (freeTh >= input.pax) return { ok: true, data: { start: new Date(t).toISOString(), availableNow: t <= now + 60_000 } };
  }
  return { ok: true, data: { start: null, availableNow: false } };
}

// Active resources of a branch with a free/busy flag for the given window. Powers
// the reservation form's optional bed picker and the "pick adjacent free" helper.
export async function getFreeBeds(input: {
  branch_id: string;
  start: string;
  end: string;
  exclude_id?: string | null;
}): Promise<ActionResult<{ beds: { id: string; name: string; type: string; zone: string; free: boolean }[] }>> {
  if (!input.branch_id || !input.start || !input.end) return { ok: false, error: 'Missing input' };
  if (new Date(input.end) <= new Date(input.start)) return { ok: false, error: 'Bad window' };
  const supabase = await createAuditedClient();
  const { data: resources } = await supabase
    .from('resources')
    .select('id, resource_name, resource_type, location_zone')
    .eq('branch_id', input.branch_id)
    .eq('status', 'active')
    .order('resource_name');
  const busy = await computeBusyResourceIds(input.branch_id, input.start, input.end, input.exclude_id);
  const beds = (resources ?? []).map((r) => ({
    id: r.id, name: r.resource_name, type: r.resource_type, zone: r.location_zone ?? '', free: !busy.has(r.id),
  }));
  return { ok: true, data: { beds } };
}

// Validate pinned beds: belong to the branch, within pax, and free for the window.
// External (in-room) reservations consume no bed here, so pins are dropped.
async function resolvePinnedBeds(
  branchId: string,
  resourceIds: string[],
  pax: number,
  categoryIds: string[],
  start: string,
  end: string,
  locationType: string,
  excludeReservationId?: string | null,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (locationType === 'external_hotel' || resourceIds.length === 0) return { ok: true, ids: [] };
  // One bed per guest: if more beds are pinned than pax (e.g. pax was lowered on
  // an edit), keep the first `pax` rather than rejecting.
  const ids = resourceIds.slice(0, Math.max(0, pax));
  if (ids.length === 0) return { ok: true, ids: [] };
  const supabase = await createAuditedClient();
  const { data: rows } = await supabase
    .from('resources')
    .select('id, resource_name')
    .eq('branch_id', branchId)
    .eq('status', 'active')
    .in('id', ids);
  const found = new Map((rows ?? []).map((r) => [r.id, r.resource_name]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) return { ok: false, error: 'A pinned bed is not an active resource of this branch' };
  // Resource-type guard — a Hair Salon booking can't pin Bed #1 (massage_bed)
  // just because it's free. The previous code only enforced this for the
  // auto-picked "extra" beds in a group; the anchor / first pin was unchecked.
  const compat = await assertBedsMatchCategories(ids, categoryIds);
  if (!compat.ok) return { ok: false, error: compat.error };
  const busy = await computeBusyResourceIds(branchId, start, end, excludeReservationId);
  const taken = ids.filter((id) => busy.has(id)).map((id) => found.get(id));
  if (taken.length) return { ok: false, error: `Already taken for this window: ${taken.join(', ')}` };
  return { ok: true, ids };
}

const bedNum = (name: string): number => { const m = name.match(/(\d+)/); return m ? Number(m[1]) : 9999; };

// Auto-pick `pax` "together" beds for a seat-together group. Adjacency =
// same resource type + same zone + consecutive bed numbers. Degrades gracefully:
// consecutive-in-a-zone → any free in one zone → any free of the type. Returns []
// if it can't fit (stays unassigned, in the top lane).
async function autoAssignAdjacentBeds(
  branchId: string,
  categoryIds: string[],
  pax: number,
  start: string,
  end: string,
  excludeReservationId?: string | null,
): Promise<string[]> {
  if (pax < 1) return [];
  const supabase = await createAuditedClient();
  const { data: cats } = await supabase
    .from('service_categories').select('required_resource_type').in('id', categoryIds);
  const types = [...new Set((cats ?? []).map((c) => c.required_resource_type).filter(Boolean) as string[])];
  if (types.length === 0) return [];
  const { data: resources } = await supabase
    .from('resources').select('id, resource_name, resource_type, location_zone')
    .eq('branch_id', branchId).eq('status', 'active').in('resource_type', types);
  const busy = await computeBusyResourceIds(branchId, start, end, excludeReservationId);
  const all = (resources ?? []).map((r) => ({ id: r.id, name: r.resource_name, type: r.resource_type, zone: r.location_zone ?? '', free: !busy.has(r.id) }));

  // First free consecutive-number run within a single zone.
  const consecutiveRun = (zoneBeds: typeof all): string[] | null => {
    const sorted = [...zoneBeds].sort((a, b) => bedNum(a.name) - bedNum(b.name));
    for (let i = 0; i + pax <= sorted.length; i++) {
      const win = sorted.slice(i, i + pax);
      const ok = win.every((b, k) => k === 0 || bedNum(b.name) - bedNum(win[k - 1].name) === 1);
      if (ok && win.every((b) => b.free)) return win.map((b) => b.id);
    }
    return null;
  };

  for (const t of types) {
    const ofType = all.filter((b) => b.type === t);
    const zones = [...new Set(ofType.map((b) => b.zone))];
    // 1) consecutive run inside one zone (true adjacency)
    for (const z of zones) { const run = consecutiveRun(ofType.filter((b) => b.zone === z)); if (run) return run; }
    // 2) any free beds within one zone (same area, may not be consecutive)
    for (const z of zones) { const free = ofType.filter((b) => b.zone === z && b.free).slice(0, pax); if (free.length === pax) return free.map((b) => b.id); }
    // 3) last resort: any free beds of the type, across zones
    const anyFree = ofType.filter((b) => b.free).slice(0, pax);
    if (anyFree.length === pax) return anyFree.map((b) => b.id);
  }
  return [];
}

// Top up an explicit set of pinned beds to `pax` total — add free beds nearest
// (by bed number, same zone preferred) to the pinned ones. So clicking one bed
// for a group reserves a consecutive-ish run that includes it.
async function topUpBeds(
  branchId: string,
  categoryIds: string[],
  seedIds: string[],
  need: number,
  start: string,
  end: string,
  excludeReservationId?: string | null,
): Promise<string[]> {
  if (need <= 0) return [];
  const supabase = await createAuditedClient();
  const { data: cats } = await supabase.from('service_categories').select('required_resource_type').in('id', categoryIds);
  const types = [...new Set((cats ?? []).map((c) => c.required_resource_type).filter(Boolean) as string[])];
  if (types.length === 0) return [];
  const { data: resources } = await supabase
    .from('resources').select('id, resource_name, resource_type, location_zone')
    .eq('branch_id', branchId).eq('status', 'active').in('resource_type', types);
  const busy = await computeBusyResourceIds(branchId, start, end, excludeReservationId);
  const seed = new Set(seedIds);
  const all = (resources ?? []).map((r) => ({ id: r.id, zone: r.location_zone ?? '', num: bedNum(r.resource_name) }));
  const seedBeds = all.filter((b) => seed.has(b.id));
  const seedZone = seedBeds[0]?.zone;
  const nums = seedBeds.map((b) => b.num);
  const lo = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 0;
  const free = all.filter((b) => !busy.has(b.id) && !seed.has(b.id));
  const score = (b: { zone: string; num: number }) => {
    const dist = b.num > hi ? b.num - hi : b.num < lo ? lo - b.num : 0;
    return (seedZone != null && b.zone !== seedZone ? 1000 : 0) + dist;
  };
  return [...free].sort((a, b) => score(a) - score(b) || a.num - b.num).slice(0, need).map((b) => b.id);
}

// Decide the beds to pin: an explicit staff override wins (topped up to pax for a
// group); otherwise a multi-pax booking is auto-assigned adjacent beds; otherwise
// none (unassigned).
async function resolveEffectiveBeds(args: {
  branchId: string;
  resourceIds: string[];
  seatTogether: boolean;
  categoryIds: string[];
  pax: number;
  start: string;
  end: string;
  locationType: string;
  excludeReservationId?: string | null;
}): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (args.locationType === 'external_hotel') return { ok: true, ids: [] };
  if (args.resourceIds.length > 0) {
    const pinned = await resolvePinnedBeds(args.branchId, args.resourceIds, args.pax, args.categoryIds, args.start, args.end, args.locationType, args.excludeReservationId);
    if (!pinned.ok) return pinned;
    // One bed per guest: if fewer beds were pinned than pax (e.g. clicked a single
    // slot on the board for a group), top up to pax with nearby free beds.
    if (args.pax > pinned.ids.length) {
      const extra = await topUpBeds(args.branchId, args.categoryIds, pinned.ids, args.pax - pinned.ids.length, args.start, args.end, args.excludeReservationId);
      return { ok: true, ids: [...pinned.ids, ...extra] };
    }
    return pinned;
  }
  // One bed per guest: any multi-pax booking auto-reserves `pax` beds (consecutive
  // preferred — see autoAssignAdjacentBeds; seat_together just makes adjacency a
  // firmer intent, which the helper already tries first). A single guest stays
  // unassigned (placed/picked later). Degrades to [] if `pax` beds can't be found,
  // so the booking simply floats in the To-place lane for manual placement.
  if (args.pax > 1) {
    const ids = await autoAssignAdjacentBeds(args.branchId, args.categoryIds, args.pax, args.start, args.end, args.excludeReservationId);
    return { ok: true, ids };
  }
  return { ok: true, ids: [] };
}
