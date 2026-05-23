'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

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

  // Beds pinned by other overlapping reservations.
  const { data: pins } = await supabase
    .from('reservation_resources')
    .select('resource_id, reservations!inner ( id, branch_id, status, deleted_at, desired_service_start, desired_service_end )')
    .eq('reservations.branch_id', branchId)
    .in('reservations.status', ['reserved', 'confirmed'])
    .is('reservations.deleted_at', null)
    .lt('reservations.desired_service_start', end)
    .gt('reservations.desired_service_end', start);
  for (const p of pins ?? []) {
    const resv = one(p.reservations);
    if (excludeReservationId && resv?.id === excludeReservationId) continue;
    if (p.resource_id) busy.add(p.resource_id);
  }
  return busy;
}

// Active resources of a branch with a free/busy flag for the given window. Powers
// the reservation form's optional bed picker and the "pick adjacent free" helper.
export async function getFreeBeds(input: {
  branch_id: string;
  start: string;
  end: string;
  exclude_id?: string | null;
}): Promise<ActionResult<{ beds: { id: string; name: string; type: string; free: boolean }[] }>> {
  if (!input.branch_id || !input.start || !input.end) return { ok: false, error: 'Missing input' };
  if (new Date(input.end) <= new Date(input.start)) return { ok: false, error: 'Bad window' };
  const supabase = createServiceClient();
  const { data: resources } = await supabase
    .from('resources')
    .select('id, resource_name, resource_type')
    .eq('branch_id', input.branch_id)
    .eq('status', 'active')
    .order('resource_name');
  const busy = await computeBusyResourceIds(input.branch_id, input.start, input.end, input.exclude_id);
  const beds = (resources ?? []).map((r) => ({
    id: r.id, name: r.resource_name, type: r.resource_type, free: !busy.has(r.id),
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

// Auto-pick `pax` adjacent free beds for a "seat together" group. Uses the first
// service-needed resource type that can fit them; prefers a consecutive-number
// run, else any free beds of that type; returns [] if it can't fit (stays
// unassigned, in the top lane).
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
    .from('resources').select('id, resource_name, resource_type')
    .eq('branch_id', branchId).eq('status', 'active').in('resource_type', types);
  const busy = await computeBusyResourceIds(branchId, start, end, excludeReservationId);
  for (const t of types) {
    const list = (resources ?? [])
      .filter((r) => r.resource_type === t)
      .sort((a, b) => bedNum(a.resource_name) - bedNum(b.resource_name))
      .map((r) => ({ id: r.id, name: r.resource_name, free: !busy.has(r.id) }));
    for (let i = 0; i + pax <= list.length; i++) {
      const win = list.slice(i, i + pax);
      const consecutive = win.every((b, k) => k === 0 || bedNum(b.name) - bedNum(win[k - 1].name) === 1);
      if (consecutive && win.every((b) => b.free)) return win.map((b) => b.id);
    }
    const anyFree = list.filter((b) => b.free).slice(0, pax);
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
  return { ok: true, data: { orderId: order.id } };
}
