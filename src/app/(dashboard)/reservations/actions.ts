'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

const schema = z.object({
  branch_id: z.string().uuid(),
  // The reservation's customer source (WALK-IN, a hotel, ENGO, …). Drives the
  // billing destination and whether a guest phone is required.
  source_id: z.string().uuid(),
  service_category_id: z.string().uuid(),
  guest_name: z.string().min(1).max(120),
  guest_phone: z.string().max(40).optional().nullable(),
  pax: z.coerce.number().int().min(1).max(50).default(1),
  gender_preference: z.string().max(20).optional().nullable(),
  desired_service_start: z.string().min(1),
  desired_service_end: z.string().min(1),
  service_location_type: z.enum(['on_site', 'external_hotel']).default('on_site'),
  note: z.string().max(500).optional().nullable(),
});

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

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

  const reservation_no = await nextReservationNo(branch.code, d.desired_service_start);

  const { error } = await supabase.from('reservations').insert({
    reservation_no,
    branch_id: d.branch_id,
    // Channel kept for schema compatibility; the source master is authoritative.
    source_type: 'phone',
    source_id: d.source_id,
    service_category_id: d.service_category_id,
    billing_to_id: source.default_billing_to_id ?? null,
    guest_name: d.guest_name,
    guest_phone: d.guest_phone || null,
    pax: d.pax,
    gender_preference: d.gender_preference || null,
    desired_service_start: d.desired_service_start,
    desired_service_end: d.desired_service_end,
    service_location_type: d.service_location_type,
    note: d.note || null,
    status: 'reserved',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reservations');
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  branch_id: z.string().uuid(),
  source_id: z.string().uuid(),
  service_category_id: z.string().uuid(),
  guest_name: z.string().min(1).max(120),
  guest_phone: z.string().max(40).optional().nullable(),
  pax: z.coerce.number().int().min(1).max(50),
  gender_preference: z.string().max(20).optional().nullable(),
  desired_service_start: z.string().min(1),
  desired_service_end: z.string().min(1),
  service_location_type: z.enum(['on_site', 'external_hotel']),
  note: z.string().max(500).optional().nullable(),
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
  const { error } = await supabase.from('reservations').update({
    branch_id: d.branch_id,
    source_id: d.source_id,
    service_category_id: d.service_category_id,
    billing_to_id: source.default_billing_to_id ?? null,
    guest_name: d.guest_name,
    guest_phone: d.guest_phone || null,
    pax: d.pax,
    gender_preference: d.gender_preference || null,
    desired_service_start: d.desired_service_start,
    desired_service_end: d.desired_service_end,
    service_location_type: d.service_location_type,
    note: d.note || null,
  }).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reservations');
  return { ok: true };
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
