'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { getReservationGraceMinutes, isReservationOverdue } from '@/lib/reservations';
import { canPerformAny, matchesGender } from '@/lib/therapist-availability';

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
});

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// Replace a reservation's service-category set (the multi-select source of truth).
async function syncReservationCategories(reservationId: string, categoryIds: string[]) {
  const supabase = createServiceClient();
  await supabase.from('reservation_service_categories').delete().eq('reservation_id', reservationId);
  if (categoryIds.length === 0) return null;
  const { error } = await supabase.from('reservation_service_categories').insert(
    categoryIds.map((service_category_id) => ({ reservation_id: reservationId, service_category_id })),
  );
  return error;
}

async function nextReservationNo(branchCode: string, dateIso: string): Promise<string> {
  const supabase = createServiceClient();
  const ymd = dateIso.slice(0, 10).replace(/-/g, '');
  const prefix = `RSV-${branchCode}-${ymd}-`;
  const { data } = await supabase
    .from('reservations')
    .select('reservation_no')
    .like('reservation_no', `${prefix}%`)
    .order('reservation_no', { ascending: false })
    .limit(1);
  const last = data?.[0]?.reservation_no;
  const lastSeq = last ? Number(last.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(3, '0')}`;
}

export async function createReservation(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  if (new Date(d.desired_service_end) <= new Date(d.desired_service_start)) {
    return { ok: false, error: 'End time must be after start time' };
  }
  const supabase = createServiceClient();
  const { data: branch, error: be } = await supabase.from('branches').select('code').eq('id', d.branch_id).single();
  if (be || !branch) return { ok: false, error: 'Branch not found' };

  // The source decides the billing destination and the contact-phone policy.
  const { data: source } = await supabase
    .from('customer_sources')
    .select('phone_required, default_billing_to_id')
    .eq('id', d.source_id)
    .maybeSingle();
  if (!source) return { ok: false, error: 'Customer source not found' };
  if (source.phone_required && !d.guest_phone?.trim()) {
    return { ok: false, error: 'A guest phone is required for this source' };
  }

  // Resolve beds: explicit staff override, else auto-assign for a "together"
  // group, else none.
  const pinned = await resolveEffectiveBeds({
    branchId: d.branch_id, resourceIds: d.resource_ids, seatTogether: d.seat_together,
    categoryIds: d.service_category_ids, pax: d.pax,
    start: d.desired_service_start, end: d.desired_service_end,
    locationType: d.service_location_type, excludeReservationId: null,
  });
  if (!pinned.ok) return { ok: false, error: pinned.error };

  const reservation_no = await nextReservationNo(branch.code, d.desired_service_start);

  const { data: created, error } = await supabase.from('reservations').insert({
    reservation_no,
    branch_id: d.branch_id,
    // Channel kept for schema compatibility; the source master is authoritative.
    source_type: 'phone',
    source_id: d.source_id,
    // Single column kept for back-compat; the junction is the source of truth.
    service_category_id: d.service_category_ids[0],
    billing_to_id: source.default_billing_to_id ?? null,
    guest_name: d.guest_name,
    guest_phone: d.guest_phone || null,
    pax: d.pax,
    gender_preference: d.gender_preference || null,
    desired_service_start: d.desired_service_start,
    desired_service_end: d.desired_service_end,
    service_location_type: d.service_location_type,
    note: d.note || null,
    seat_together: d.seat_together,
    status: 'reserved',
  }).select('id').single();
  if (error || !created) return { ok: false, error: error?.message ?? 'Insert failed' };
  const linkErr = await syncReservationCategories(created.id, d.service_category_ids);
  if (linkErr) return { ok: false, error: linkErr.message };
  const pinErr = await syncReservationResources(created.id, pinned.ids);
  if (pinErr) return { ok: false, error: pinErr.message };
  revalidatePath('/reservations');
  revalidatePath('/shift-schedule');
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  branch_id: z.string().uuid(),
  source_id: z.string().uuid(),
  service_category_ids: z.array(z.string().uuid()).min(1, 'Pick at least one service type'),
  guest_name: z.string().min(1).max(120),
  guest_phone: z.string().max(40).optional().nullable(),
  pax: z.coerce.number().int().min(1).max(50),
  gender_preference: z.string().max(20).optional().nullable(),
  desired_service_start: z.string().min(1),
  desired_service_end: z.string().min(1),
  service_location_type: z.enum(['on_site', 'external_hotel']),
  note: z.string().max(500).optional().nullable(),
  resource_ids: z.array(z.string().uuid()).optional().default([]),
  seat_together: z.boolean().optional().default(false),
});

export async function updateReservation(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  if (new Date(d.desired_service_end) <= new Date(d.desired_service_start)) {
    return { ok: false, error: 'End time must be after start time' };
  }
  const supabase = createServiceClient();
  const { data: existing } = await supabase.from('reservations').select('status').eq('id', d.id).maybeSingle();
  if (!existing) return { ok: false, error: 'Reservation not found' };
  if (['converted', 'cancelled', 'no_show'].includes(existing.status)) {
    return { ok: false, error: `A ${existing.status.replace('_', ' ')} reservation can't be edited` };
  }
  // Source decides billing + the contact-phone policy (same as on create).
  const { data: source } = await supabase
    .from('customer_sources')
    .select('phone_required, default_billing_to_id')
    .eq('id', d.source_id)
    .maybeSingle();
  if (!source) return { ok: false, error: 'Customer source not found' };
  if (source.phone_required && !d.guest_phone?.trim()) {
    return { ok: false, error: 'A guest phone is required for this source' };
  }
  const pinned = await resolveEffectiveBeds({
    branchId: d.branch_id, resourceIds: d.resource_ids, seatTogether: d.seat_together,
    categoryIds: d.service_category_ids, pax: d.pax,
    start: d.desired_service_start, end: d.desired_service_end,
    locationType: d.service_location_type, excludeReservationId: d.id,
  });
  if (!pinned.ok) return { ok: false, error: pinned.error };
  const { error } = await supabase.from('reservations').update({
    branch_id: d.branch_id,
    source_id: d.source_id,
    service_category_id: d.service_category_ids[0],
    billing_to_id: source.default_billing_to_id ?? null,
    guest_name: d.guest_name,
    guest_phone: d.guest_phone || null,
    pax: d.pax,
    gender_preference: d.gender_preference || null,
    desired_service_start: d.desired_service_start,
    desired_service_end: d.desired_service_end,
    service_location_type: d.service_location_type,
    note: d.note || null,
    seat_together: d.seat_together,
  }).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  const linkErr = await syncReservationCategories(d.id, d.service_category_ids);
  if (linkErr) return { ok: false, error: linkErr.message };
  const pinErr = await syncReservationResources(d.id, pinned.ids);
  if (pinErr) return { ok: false, error: pinErr.message };
  revalidatePath('/reservations');
  revalidatePath('/shift-schedule');
  return { ok: true };
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
  const supabase = createServiceClient();

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

  // Overlapping reservations (still live) → demand per resource type.
  const { data: overlapping } = await supabase
    .from('reservations')
    .select('id, pax, reservation_service_categories ( service_categories ( required_resource_type ) )')
    .eq('branch_id', input.branch_id)
    .in('status', ['reserved', 'confirmed'])
    .is('deleted_at', null)
    .lt('desired_service_start', input.end)
    .gt('desired_service_end', input.start);
  const used: Record<string, number> = {};
  for (const r of overlapping ?? []) {
    if (input.exclude_id && r.id === input.exclude_id) continue;
    const types = new Set<string>();
    for (const link of r.reservation_service_categories ?? []) {
      const cat = one(link.service_categories);
      if (cat?.required_resource_type) types.add(cat.required_resource_type);
    }
    for (const t of types) used[t] = (used[t] ?? 0) + (r.pax ?? 1);
  }

  const byType: Record<string, { capacity: number; used: number }> = {};
  for (const t of new Set([...Object.keys(capacity), ...Object.keys(used)])) {
    byType[t] = { capacity: capacity[t] ?? 0, used: used[t] ?? 0 };
  }
  return { ok: true, data: { byType } };
}

// Replace a reservation's pinned beds (hybrid optional binding).
async function syncReservationResources(reservationId: string, resourceIds: string[]) {
  const supabase = createServiceClient();
  await supabase.from('reservation_resources').delete().eq('reservation_id', reservationId);
  if (resourceIds.length === 0) return null;
  const { error } = await supabase.from('reservation_resources').insert(
    resourceIds.map((resource_id) => ({ reservation_id: reservationId, resource_id })),
  );
  return error;
}

// Resource IDs unavailable in [start,end): occupied by a live order (incl. its
// cleanup tail) or already pinned by another overlapping reservation.
async function computeBusyResourceIds(
  branchId: string,
  start: string,
  end: string,
  excludeReservationId?: string | null,
): Promise<Set<string>> {
  const supabase = createServiceClient();
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const busy = new Set<string>();

  // Live orders sitting on a bed — use actual times plus the cleanup tail.
  const lookback = new Date(startMs - 12 * 3600 * 1000).toISOString();
  const { data: items } = await supabase
    .from('order_items')
    .select('resource_id, actual_start, actual_end, duration_minutes, service:service_items ( cleanup_after_minutes ), order:orders!order_items_order_id_fkey ( branch_id )')
    .not('resource_id', 'is', null)
    .not('actual_start', 'is', null)
    .gte('actual_start', lookback)
    .lt('actual_start', end);
  for (const it of items ?? []) {
    if (one(it.order)?.branch_id !== branchId || !it.resource_id) continue;
    const s = Date.parse(it.actual_start as string);
    const e0 = it.actual_end ? Date.parse(it.actual_end) : s + (it.duration_minutes ?? 60) * 60000;
    const e = e0 + (one(it.service)?.cleanup_after_minutes ?? 0) * 60000;
    if (s < endMs && startMs < e) busy.add(it.resource_id);
  }

  // Beds pinned by other overlapping reservations. Only a *confirmed* reservation
  // actually holds its bed (pending ones are tentative); an Overdue one
  // auto-releases its bed, so its pin no longer blocks others.
  const graceMin = await getReservationGraceMinutes();
  const { data: pins } = await supabase
    .from('reservation_resources')
    .select('resource_id, reservations!inner ( id, branch_id, status, deleted_at, desired_service_start, desired_service_end )')
    .eq('reservations.branch_id', branchId)
    .eq('reservations.status', 'confirmed')
    .is('reservations.deleted_at', null)
    .lt('reservations.desired_service_start', end)
    .gt('reservations.desired_service_end', start);
  for (const p of pins ?? []) {
    const resv = one(p.reservations);
    if (excludeReservationId && resv?.id === excludeReservationId) continue;
    if (resv && isReservationOverdue({ status: resv.status, desiredStartIso: resv.desired_service_start, graceMin })) continue;
    if (p.resource_id) busy.add(p.resource_id);
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
  service_category_id?: string | null; // only count therapists who can perform it
}): Promise<ActionResult<{ start: string | null; availableNow: boolean }>> {
  if (!input.branch_id || !input.resource_type) return { ok: false, error: 'Missing input' };
  const supabase = createServiceClient();
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

    // Capability: the service_groups within the chosen category, and each pool
    // member's own skills (shared rule via canPerformAny).
    let groups = new Set<string>();
    const capsByEmp = new Map<string, string[]>();
    if (input.service_category_id) {
      const { data: catItems } = await supabase.from('service_items').select('service_group').eq('service_category_id', input.service_category_id);
      groups = new Set((catItems ?? []).map((i) => i.service_group).filter(Boolean) as string[]);
      if (groups.size > 0) {
        const { data: caps } = await supabase.from('employee_service_groups').select('employee_id, service_group').in('employee_id', poolIds);
        for (const c of caps ?? []) (capsByEmp.get(c.employee_id) ?? capsByEmp.set(c.employee_id, []).get(c.employee_id)!).push(c.service_group);
      }
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
  const { data: pins } = await supabase
    .from('reservation_resources')
    .select('reservations!inner ( branch_id, status, deleted_at, desired_service_end )')
    .in('resource_id', typeIds)
    .eq('reservations.status', 'confirmed').is('reservations.deleted_at', null);
  for (const p of pins ?? []) {
    const r = one(p.reservations);
    if (r?.branch_id === input.branch_id) ends.push(Date.parse(r.desired_service_end));
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
  const supabase = createServiceClient();
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
  start: string,
  end: string,
  locationType: string,
  excludeReservationId?: string | null,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (locationType === 'external_hotel' || resourceIds.length === 0) return { ok: true, ids: [] };
  if (resourceIds.length > pax) return { ok: false, error: `Can't pin more beds (${resourceIds.length}) than pax (${pax})` };
  const supabase = createServiceClient();
  const { data: rows } = await supabase
    .from('resources')
    .select('id, resource_name')
    .eq('branch_id', branchId)
    .eq('status', 'active')
    .in('id', resourceIds);
  const found = new Map((rows ?? []).map((r) => [r.id, r.resource_name]));
  const missing = resourceIds.filter((id) => !found.has(id));
  if (missing.length) return { ok: false, error: 'A pinned bed is not an active resource of this branch' };
  const busy = await computeBusyResourceIds(branchId, start, end, excludeReservationId);
  const taken = resourceIds.filter((id) => busy.has(id)).map((id) => found.get(id));
  if (taken.length) return { ok: false, error: `Already taken for this window: ${taken.join(', ')}` };
  return { ok: true, ids: resourceIds };
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
  const supabase = createServiceClient();
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

// Decide the beds to pin: an explicit staff override wins; otherwise a "seat
// together" group is auto-assigned adjacent beds; otherwise none (unassigned).
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
    return resolvePinnedBeds(args.branchId, args.resourceIds, args.pax, args.start, args.end, args.locationType, args.excludeReservationId);
  }
  if (args.seatTogether && args.pax > 1) {
    const ids = await autoAssignAdjacentBeds(args.branchId, args.categoryIds, args.pax, args.start, args.end, args.excludeReservationId);
    return { ok: true, ids };
  }
  return { ok: true, ids: [] };
}

export async function setReservationStatus(
  id: string,
  status: 'reserved' | 'confirmed' | 'cancelled' | 'no_show',
): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('reservations').update({ status }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reservations');
  revalidatePath('/shift-schedule');
  return { ok: true };
}

// Confirm a pending reservation — this is the point it becomes "established" and
// actually holds its bed(s). Beds are re-resolved against current (confirmed-only)
// occupancy: explicit pins must still be free (else error → adjust & retry); a
// seat-together group is auto-assigned fresh adjacent beds now.
export async function confirmReservation(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { data: r } = await supabase
    .from('reservations')
    .select('id, branch_id, status, pax, seat_together, service_location_type, desired_service_start, desired_service_end, reservation_service_categories ( service_category_id ), reservation_resources ( resource_id )')
    .eq('id', id)
    .maybeSingle();
  if (!r) return { ok: false, error: 'Reservation not found' };
  if (r.status !== 'reserved') return { ok: false, error: 'Only a pending reservation can be confirmed' };

  const categoryIds = (r.reservation_service_categories ?? []).map((x) => x.service_category_id);
  const intendedPins = (r.reservation_resources ?? []).map((x) => x.resource_id);
  const resolved = await resolveEffectiveBeds({
    branchId: r.branch_id, resourceIds: intendedPins, seatTogether: r.seat_together,
    categoryIds, pax: r.pax, start: r.desired_service_start, end: r.desired_service_end,
    locationType: r.service_location_type ?? 'on_site', excludeReservationId: id,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const { error } = await supabase.from('reservations').update({ status: 'confirmed' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  const pinErr = await syncReservationResources(id, resolved.ids);
  if (pinErr) return { ok: false, error: pinErr.message };
  revalidatePath('/reservations');
  revalidatePath('/shift-schedule');
  return { ok: true };
}

// Create a draft Sales Order from a reservation and mark it converted.
export async function convertReservationToOrder(id: string): Promise<ActionResult<{ orderId: string }>> {
  const supabase = createServiceClient();
  const { data: r, error: re } = await supabase
    .from('reservations')
    .select('id, branch_id, source_id, billing_to_id, desired_service_start, status, guest_name, guest_phone')
    .eq('id', id)
    .single();
  if (re || !r) return { ok: false, error: 'Reservation not found' };
  if (r.status === 'converted') return { ok: false, error: 'Already converted' };
  if (['cancelled', 'no_show'].includes(r.status)) return { ok: false, error: `Cannot convert a ${r.status} reservation` };

  const { data: branch } = await supabase.from('branches').select('code').eq('id', r.branch_id).single();
  const serviceDate = r.desired_service_start.slice(0, 10);
  const ymd = serviceDate.replace(/-/g, '');
  const prefix = `SO-${branch?.code ?? 'X'}-${ymd}-`;
  const { data: lastOrder } = await supabase
    .from('orders').select('order_no').like('order_no', `${prefix}%`).order('order_no', { ascending: false }).limit(1);
  const seq = lastOrder?.[0]?.order_no ? Number(lastOrder[0].order_no.slice(prefix.length)) : 0;
  const order_no = `${prefix}${String(seq + 1).padStart(3, '0')}`;

  const { data: order, error: oe } = await supabase
    .from('orders')
    .insert({
      order_no,
      branch_id: r.branch_id,
      source_id: r.source_id,
      billing_to_id: r.billing_to_id,
      reservation_id: r.id,
      order_type: 'reservation',
      service_date: serviceDate,
      status: 'draft',
    })
    .select('id')
    .single();
  if (oe || !order) return { ok: false, error: oe?.message ?? 'Could not create order' };

  // Carry the guest as the first order customer.
  await supabase.from('order_customers').insert({
    order_id: order.id,
    customer_name: r.guest_name,
    customer_phone: r.guest_phone,
    seq_no: 1,
  });

  await supabase.from('reservations').update({ status: 'converted' }).eq('id', id);

  revalidatePath('/reservations');
  revalidatePath('/sales-orders');
  revalidatePath('/shift-schedule');
  return { ok: true, data: { orderId: order.id } };
}
