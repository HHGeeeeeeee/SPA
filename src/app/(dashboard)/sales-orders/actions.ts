'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';

// Append a row to the generic status-change audit log.
async function logStatus(
  orderId: string,
  from: string | null,
  to: string,
  reason: string | null,
  staffId: string | null,
) {
  const supabase = createServiceClient();
  await supabase.from('order_status_log').insert({
    entity_type: 'order',
    entity_id: orderId,
    from_status: from,
    to_status: to,
    reason: reason ?? null,
    changed_by_staff_id: staffId,
  });
}

const schema = z.object({
  branch_id: z.string().uuid(),
  business_unit_id: z.string().uuid().optional().nullable(),
  source_id: z.string().uuid().optional().nullable(),
  billing_to_id: z.string().uuid().optional().nullable(),
  order_type: z.enum(['walk_in', 'reservation', 'package_use', 'stored_value', 'external']).default('walk_in'),
  service_date: z.string().min(1),
  note: z.string().max(500).optional().nullable(),
});

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function nextOrderNo(branchCode: string, serviceDate: string): Promise<string> {
  const supabase = createServiceClient();
  const ymd = serviceDate.replace(/-/g, '');
  const prefix = `SO-${branchCode}-${ymd}-`;
  const { data } = await supabase
    .from('orders')
    .select('order_no')
    .like('order_no', `${prefix}%`)
    .order('order_no', { ascending: false })
    .limit(1);
  const last = data?.[0]?.order_no;
  const lastSeq = last ? Number(last.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(3, '0')}`;
}

export async function createDraftOrder(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const supabase = createServiceClient();

  const { data: branch, error: be } = await supabase
    .from('branches')
    .select('code, branch_business_units ( business_unit_id )')
    .eq('id', d.branch_id)
    .single();
  if (be || !branch) return { ok: false, error: 'Branch not found' };

  const branchUnitIds = (branch.branch_business_units ?? []).map((r) => r.business_unit_id);
  if (d.business_unit_id && !branchUnitIds.includes(d.business_unit_id)) {
    return { ok: false, error: 'Selected business unit is not assigned to this branch' };
  }
  // Branch hosts exactly one unit → attribute automatically.
  const businessUnitId = d.business_unit_id ?? (branchUnitIds.length === 1 ? branchUnitIds[0] : null);

  // Billing follows the customer source. The source's default billing
  // destination is authoritative and overrides whatever the client sends, so a
  // hotel-sourced order is always billed to that hotel (intercompany) — the
  // guest pays the hotel, and we collect from the hotel. Never SELF.
  let billingToId = d.billing_to_id || null;
  if (d.source_id) {
    const { data: src } = await supabase
      .from('customer_sources')
      .select('default_billing_to_id')
      .eq('id', d.source_id)
      .maybeSingle();
    if (!src) return { ok: false, error: 'Customer source not found' };
    if (src.default_billing_to_id) billingToId = src.default_billing_to_id;
  }

  const order_no = await nextOrderNo(branch.code, d.service_date);

  const { data, error } = await supabase
    .from('orders')
    .insert({
      order_no,
      branch_id: d.branch_id,
      business_unit_id: businessUnitId,
      source_id: d.source_id || null,
      billing_to_id: billingToId,
      order_type: d.order_type,
      service_date: d.service_date,
      note: d.note || null,
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed' };

  revalidatePath('/sales-orders');
  return { ok: true, data: { id: data.id } };
}

export async function voidOrder(id: string, reason: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to void' };
  if (!reason || reason.trim().length < 3) return { ok: false, error: 'A reason is required to void' };
  const supabase = createServiceClient();
  const { data: order } = await supabase.from('orders').select('status').eq('id', id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'A closed or already-void order cannot be voided' };
  }
  const { error } = await supabase.from('orders').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await logStatus(id, order.status, 'void', reason.trim(), session!.staffUserId);
  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${id}`);
  return { ok: true };
}

// Reopen a Completed order back to Open so it can be edited again. Manager-only,
// reason required, snapshot written to order_edit_log.
export async function reopenOrder(id: string, reason: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to reopen' };
  if (!reason || reason.trim().length < 3) return { ok: false, error: 'A reason is required to reopen' };
  const supabase = createServiceClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, total_cents, paid_cents, subtotal_cents, discount_cents')
    .eq('id', id)
    .single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'completed') {
    return { ok: false, error: 'Only a Completed order can be reopened. Reverse the payment first if it is Paid.' };
  }
  const { error } = await supabase.from('orders').update({ status: 'open' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('order_edit_log').insert({
    order_id: id,
    before_snapshot: order,
    after_snapshot: { ...order, status: 'open' },
    edit_reason: reason.trim(),
    from_status: 'completed',
    to_status: 'open',
    edited_by_staff_id: session!.staffUserId,
  });
  await logStatus(id, 'completed', 'open', reason.trim(), session!.staffUserId);
  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Line-item editor
// ---------------------------------------------------------------------------

async function recomputeTotals(orderId: string) {
  const supabase = createServiceClient();
  const { data: items } = await supabase
    .from('order_items')
    .select('list_price_cents, discount_amount_cents, final_amount_cents')
    .eq('order_id', orderId)
    .neq('status', 'cancelled');
  const subtotal = (items ?? []).reduce((s, i) => s + i.list_price_cents, 0);
  const discount = (items ?? []).reduce((s, i) => s + i.discount_amount_cents, 0);
  const total = (items ?? []).reduce((s, i) => s + i.final_amount_cents, 0);
  await supabase
    .from('orders')
    .update({ subtotal_cents: subtotal, discount_cents: discount, total_cents: total })
    .eq('id', orderId);
}

// Complete an in-service order once no line is still scheduled or running.
async function maybeAutoComplete(orderId: string) {
  const supabase = createServiceClient();
  const { data: remaining } = await supabase
    .from('order_items')
    .select('id')
    .eq('order_id', orderId)
    .in('status', ['scheduled', 'in_service'])
    .limit(1);
  if (remaining && remaining.length > 0) return;
  const { data: ord } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (ord?.status === 'in_service') {
    await supabase.from('orders').update({ status: 'completed' }).eq('id', orderId);
    await logStatus(orderId, 'in_service', 'completed', 'All services finished', null);
  }
}

const addCustomerSchema = z.object({
  order_id: z.string().uuid(),
  customer_name: z.string().min(1).max(120),
  customer_phone: z.string().max(40).optional().nullable(),
  gender: z.string().max(10).optional().nullable(),
});

export async function addOrderCustomer(input: unknown): Promise<ActionResult> {
  const parsed = addCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('order_customers')
    .select('seq_no')
    .eq('order_id', d.order_id)
    .order('seq_no', { ascending: false })
    .limit(1);
  const nextSeq = (existing?.[0]?.seq_no ?? 0) + 1;
  const { error } = await supabase.from('order_customers').insert({
    order_id: d.order_id,
    customer_name: d.customer_name,
    customer_phone: d.customer_phone || null,
    gender: d.gender || null,
    seq_no: nextSeq,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

export async function removeOrderCustomer(customerId: string, orderId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('order_customers').delete().eq('id', customerId);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(orderId);
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

const updateCustomerSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  customer_name: z.string().min(1).max(120),
  customer_phone: z.string().max(40).optional().nullable(),
});

// Rename / re-phone an existing guest (e.g. fill in a converted booking's
// "Guest 2" placeholder once they're at the desk).
export async function updateOrderCustomer(input: unknown): Promise<ActionResult> {
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('order_customers')
    .update({ customer_name: d.customer_name, customer_phone: d.customer_phone || null })
    .eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const addItemSchema = z.object({
  order_id: z.string().uuid(),
  order_customer_id: z.string().uuid(),
  service_item_id: z.string().uuid(),
  therapist_id: z.string().uuid().optional().nullable(),
  resource_id: z.string().uuid().optional().nullable(),
  discount_class_id: z.string().uuid(),
  // Manager-entered amount for variable discounts (DIS-91 / DIS-99), in pesos.
  discount_override: z.coerce.number().min(0).optional().nullable(),
});

// Special discounts need manager authority (and a variable amount for 91/99).
const MANAGER_DISCOUNTS = ['DIS-90', 'DIS-91', 'DIS-99'];
const VARIABLE_DISCOUNTS = ['DIS-91', 'DIS-99'];

// Shared line pricing for add + edit: resolve service → category/duration, the
// active list price, the discount (honoring a source's locked group rate +
// manager-only discounts), and the therapist's home branch. Returns the column
// patch both paths write, or an error message.
interface LinePatch {
  service_item_id: string;
  service_category_id: string;
  therapist_id: string | null;
  therapist_home_branch_id: string | null;
  resource_id: string | null;
  duration_minutes: number;
  list_price_cents: number;
  discount_class_id: string;
  discount_amount_cents: number;
  final_amount_cents: number;
}

async function resolveLinePricing(
  supabase: ReturnType<typeof createServiceClient>,
  d: {
    order_id: string;
    service_item_id: string;
    therapist_id?: string | null;
    resource_id?: string | null;
    discount_class_id: string;
    discount_override?: number | null;
  },
): Promise<{ error: string } | { patch: LinePatch }> {
  // If the order's customer source locks the discount (group rate), force the
  // source's default discount and ignore whatever the client sent.
  const { data: ord } = await supabase
    .from('orders')
    .select('source:customer_sources ( discount_locked, default_discount_class_id )')
    .eq('id', d.order_id)
    .maybeSingle();
  const ordSource = ord ? (Array.isArray(ord.source) ? ord.source[0] : ord.source) : null;
  const discountClassId = ordSource?.discount_locked && ordSource.default_discount_class_id
    ? ordSource.default_discount_class_id
    : d.discount_class_id;

  // Service item → category, duration
  const { data: svc, error: se } = await supabase
    .from('service_items')
    .select('id, service_category_id, duration_minutes')
    .eq('id', d.service_item_id)
    .single();
  if (se || !svc) return { error: 'Service item not found' };

  // A station must be active to be assigned (cleaning/maintenance/closed reject).
  if (d.resource_id) {
    const { data: resource } = await supabase
      .from('resources')
      .select('status')
      .eq('id', d.resource_id)
      .single();
    if (!resource) return { error: 'Station not found' };
    if (resource.status !== 'active') return { error: `Station is ${resource.status}, not available` };
  }

  // Active Normal / all-branch list price
  const { data: priceRow } = await supabase
    .from('service_item_prices')
    .select('price_cents')
    .eq('service_item_id', d.service_item_id)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .limit(1)
    .maybeSingle();
  if (!priceRow) return { error: 'No list price set for this service. Set one in Service Items.' };
  const listPrice = priceRow.price_cents;

  // Discount
  const { data: disc, error: de } = await supabase
    .from('discount_classes')
    .select('code, discount_percent, discount_amount_cents')
    .eq('id', discountClassId)
    .single();
  if (de || !disc) return { error: 'Discount class not found' };

  if (MANAGER_DISCOUNTS.includes(disc.code) && !isManager(await currentSession())) {
    return { error: `${disc.code} requires manager permission` };
  }

  let discountAmount = 0;
  if (disc.code === 'DIS-90') {
    discountAmount = listPrice; // complaint — 100% off
  } else if (VARIABLE_DISCOUNTS.includes(disc.code)) {
    const override = Math.round((d.discount_override ?? 0) * 100);
    if (override <= 0) return { error: `Enter a discount amount for ${disc.code}` };
    discountAmount = Math.min(override, listPrice);
  } else if (disc.discount_percent > 0) {
    discountAmount = Math.round((listPrice * disc.discount_percent) / 100);
  } else if (disc.discount_amount_cents > 0) {
    discountAmount = Math.min(disc.discount_amount_cents, listPrice);
  }
  const finalAmount = Math.max(0, listPrice - discountAmount);

  // Therapist home branch for commission attribution (commission itself is
  // computed later by the commission settlement module — left NULL here).
  let therapistHomeBranch: string | null = null;
  if (d.therapist_id) {
    const { data: emp } = await supabase
      .from('employees')
      .select('home_branch_id')
      .eq('id', d.therapist_id)
      .single();
    therapistHomeBranch = emp?.home_branch_id ?? null;
  }

  return {
    patch: {
      service_item_id: d.service_item_id,
      service_category_id: svc.service_category_id,
      therapist_id: d.therapist_id || null,
      therapist_home_branch_id: therapistHomeBranch,
      resource_id: d.resource_id || null,
      duration_minutes: svc.duration_minutes,
      list_price_cents: listPrice,
      discount_class_id: discountClassId,
      discount_amount_cents: discountAmount,
      final_amount_cents: finalAmount,
    },
  };
}

export async function addOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();

  const res = await resolveLinePricing(supabase, d);
  if ('error' in res) return { ok: false, error: res.error };

  const { error } = await supabase.from('order_items').insert({
    order_id: d.order_id,
    order_customer_id: d.order_customer_id,
    ...res.patch,
    status: 'scheduled',
  });
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const updateItemSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  service_item_id: z.string().uuid(),
  therapist_id: z.string().uuid().optional().nullable(),
  resource_id: z.string().uuid().optional().nullable(),
  discount_class_id: z.string().uuid(),
  discount_override: z.coerce.number().min(0).optional().nullable(),
});

// Edit a not-yet-started line: re-price for the new service/discount and
// reassign therapist/station. Blocked once the line is in-service or done (the
// numbers are committed by then — delete + re-add for those).
export async function updateOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();

  const { data: existing } = await supabase.from('order_items').select('status').eq('id', d.id).single();
  if (!existing) return { ok: false, error: 'Service line not found' };
  if (existing.status !== 'scheduled') return { ok: false, error: 'Only a not-yet-started line can be edited' };

  const res = await resolveLinePricing(supabase, d);
  if ('error' in res) return { ok: false, error: res.error };

  const { error } = await supabase.from('order_items').update(res.patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

export async function removeOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('order_items').delete().eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(orderId);
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// Per-item service timing — drives real-time therapist availability.
export async function startOrderItem(
  itemId: string,
  orderId: string,
  allowConcurrent = false,
): Promise<ActionResult> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // No double-booking: the therapist and the station can't already be mid-service
  // on another line.
  const { data: item } = await supabase
    .from('order_items')
    .select('therapist_id, resource_id, order_customer_id')
    .eq('id', itemId)
    .single();

  // One guest does one service at a time unless the operator confirms a parallel
  // service (e.g. foot massage + scalp care together).
  if (!allowConcurrent && item?.order_customer_id) {
    const { data: sameGuest } = await supabase
      .from('order_items')
      .select('id')
      .eq('order_customer_id', item.order_customer_id)
      .eq('status', 'in_service')
      .neq('id', itemId)
      .limit(1);
    if (sameGuest && sameGuest.length > 0) {
      return { ok: false, error: 'This guest already has a service in progress' };
    }
  }
  if (item?.therapist_id) {
    const { data: busy } = await supabase
      .from('order_items')
      .select('id')
      .eq('status', 'in_service')
      .eq('therapist_id', item.therapist_id)
      .neq('id', itemId)
      .limit(1);
    if (busy && busy.length > 0) return { ok: false, error: 'This therapist is already mid-service on another line' };
  }
  if (item?.resource_id) {
    const { data: busy } = await supabase
      .from('order_items')
      .select('id')
      .eq('status', 'in_service')
      .eq('resource_id', item.resource_id)
      .neq('id', itemId)
      .limit(1);
    if (busy && busy.length > 0) return { ok: false, error: 'This station is occupied by another in-service line' };
  }

  const { error } = await supabase
    .from('order_items')
    .update({ status: 'in_service', actual_start: now, service_start: now })
    .eq('id', itemId);
  if (error) return { ok: false, error: error.message };

  // Starting the first service moves the order into service automatically —
  // no separate "Start Service" step. Per-line starts still stamp each time.
  const { data: ord } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (ord?.status === 'open') {
    await supabase.from('orders').update({ status: 'in_service' }).eq('id', orderId);
    await logStatus(orderId, 'open', 'in_service', 'First service started', null);
  }

  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// One-click batch: start the first scheduled service for each guest who isn't
// already mid-service (one per guest, so a multi-service guest only starts
// their first line). Reuses startOrderItem so all the busy/booking checks and
// the order auto-advance apply.
export async function startAllServices(orderId: string): Promise<ActionResult<{ started: number; skipped: number }>> {
  const supabase = createServiceClient();
  const { data: items } = await supabase
    .from('order_items')
    .select('id, order_customer_id, status, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (!items || items.length === 0) return { ok: false, error: 'No services to start' };

  const busyCustomers = new Set(items.filter((i) => i.status === 'in_service').map((i) => i.order_customer_id));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (it.status !== 'scheduled' || busyCustomers.has(it.order_customer_id) || seen.has(it.order_customer_id)) continue;
    seen.add(it.order_customer_id);
    picked.push(it.id);
  }
  if (picked.length === 0) return { ok: false, error: 'No services are ready to start' };

  let started = 0;
  for (const id of picked) {
    const r = await startOrderItem(id, orderId, false);
    if (r.ok) started += 1;
  }
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true, data: { started, skipped: picked.length - started } };
}

export async function finishOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { data: item } = await supabase
    .from('order_items')
    .select('actual_start')
    .eq('id', itemId)
    .single();
  const patch: { status: string; actual_end: string; service_end: string; actual_duration_minutes?: number } = {
    status: 'service_completed',
    actual_end: now,
    service_end: now,
  };
  if (item?.actual_start) {
    patch.actual_duration_minutes = Math.max(1, Math.round((Date.parse(now) - Date.parse(item.actual_start)) / 60000));
  }
  const { error } = await supabase.from('order_items').update(patch).eq('id', itemId);
  if (error) return { ok: false, error: error.message };

  // Finishing the last active service auto-completes the order.
  await maybeAutoComplete(orderId);

  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// "Ready now" — free a bed before its post-service cleanup buffer has elapsed.
// A finished line holds its bed for the service's cleanup_after_minutes (the bed
// auto-frees when that window passes); stamping bed_released_at frees it at once.
export async function releaseBed(itemId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { data: item } = await supabase
    .from('order_items')
    .select('order_id, actual_end, resource_id, bed_released_at')
    .eq('id', itemId)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.bed_released_at) return { ok: true }; // already released — no-op
  if (!item.resource_id) return { ok: false, error: 'This line has no bed to release' };
  if (!item.actual_end) return { ok: false, error: 'Service is still running — finish it first' };
  const { error } = await supabase
    .from('order_items')
    .update({ bed_released_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${item.order_id}`);
  revalidatePath('/shift-schedule');
  return { ok: true };
}

// Skip a not-yet-started service line (guest decides not to do it). It's marked
// cancelled, drops out of the totals, and no longer blocks auto-completion.
export async function skipOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { data: item } = await supabase.from('order_items').select('status').eq('id', itemId).single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.status !== 'scheduled') {
    return { ok: false, error: 'Only a not-yet-started service can be skipped (use Interrupt once it has started)' };
  }
  const { error } = await supabase.from('order_items').update({ status: 'cancelled' }).eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(orderId);
  await maybeAutoComplete(orderId);
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

const interruptSchema = z.object({
  item_id: z.string().uuid(),
  order_id: z.string().uuid(),
  reason: z.string().min(3).max(300),
  handling: z.enum(['no_charge', 'partial_charge', 'full_charge', 'reschedule']),
});

// Interrupt an in-service line. Handling decides the charge: full keeps it,
// no_charge/reschedule zero it, partial prorates by actual vs planned minutes.
export async function interruptOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = interruptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();

  const { data: item } = await supabase
    .from('order_items')
    .select('actual_start, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, status')
    .eq('id', d.item_id)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.status !== 'in_service') return { ok: false, error: 'Only an in-service line can be interrupted' };

  const now = new Date().toISOString();
  const actualMin = item.actual_start
    ? Math.max(1, Math.round((Date.parse(now) - Date.parse(item.actual_start)) / 60000))
    : 0;

  let discount = item.discount_amount_cents;
  let final = item.final_amount_cents;
  if (d.handling === 'no_charge' || d.handling === 'reschedule') {
    discount = item.list_price_cents;
    final = 0;
  } else if (d.handling === 'partial_charge') {
    const planned = item.duration_minutes || 0;
    const ratio = planned > 0 ? Math.min(1, actualMin / planned) : 1;
    final = Math.round(item.final_amount_cents * ratio);
    discount = item.list_price_cents - final;
  }

  const { error } = await supabase
    .from('order_items')
    .update({
      status: 'interrupted',
      interruption_reason: d.reason,
      interruption_at: now,
      interruption_handling: d.handling,
      actual_end: now,
      actual_duration_minutes: actualMin,
      discount_amount_cents: discount,
      final_amount_cents: final,
    })
    .eq('id', d.item_id);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(d.order_id);
  // Interrupting the last active service also wraps up the order.
  await maybeAutoComplete(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const feedbackSchema = z.object({
  order_id: z.string().uuid(),
  order_item_id: z.string().uuid(),
  score: z.coerce.number().int().min(1).max(10),
  age: z.coerce.number().int().min(1).max(120).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  comment: z.string().max(1000).optional().nullable(),
});

// Customer feedback per service line. Score (1-10) is required; submitting marks
// the item feedback_done. Spec: feedback submission is the service-complete check.
export async function submitFeedback(input: unknown): Promise<ActionResult> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'A score (1-10) is required' };
  const d = parsed.data;
  const supabase = createServiceClient();

  const { data: item } = await supabase
    .from('order_items')
    .select('therapist_id, status')
    .eq('id', d.order_item_id)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };

  await supabase.from('feedback').delete().eq('order_item_id', d.order_item_id);
  const { error } = await supabase.from('feedback').insert({
    order_id: d.order_id,
    order_item_id: d.order_item_id,
    therapist_id: item.therapist_id,
    score: d.score,
    age: d.age ?? null,
    email: d.email ? d.email : null,
    comment: d.comment || null,
    language: 'en',
    status: 'filled',
    filled_via: 'tablet',
    filled_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  if (item.status === 'service_completed') {
    await supabase.from('order_items').update({ status: 'feedback_done' }).eq('id', d.order_item_id);
  }
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payment + status machine
// ---------------------------------------------------------------------------

// A closed order can no longer be reopened/voided; correcting it goes through an
// OrderAdjustment (the reversal journal itself is posted in the ERP phase).
export async function requestOrderAdjustment(orderId: string, reason: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  if (!reason || reason.trim().length < 3) return { ok: false, error: 'A reason is required' };
  const supabase = createServiceClient();
  const { data: order } = await supabase
    .from('orders')
    .select('status, total_cents, service_date')
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'closed') return { ok: false, error: 'Only a closed order needs an adjustment (reopen/void otherwise)' };
  const nowMonth = new Date().toISOString().slice(0, 7);
  const { error } = await supabase.from('order_adjustments').insert({
    original_order_id: orderId,
    adjustment_type: 'reversal',
    amount_cents: order.total_cents,
    reason: reason.trim(),
    original_month: order.service_date.slice(0, 7),
    adjustment_month: nowMonth,
    approved_by_user_id: session!.staffUserId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// Forward-only moves a cashier drives. Paid is reached by takePayment; Closed is
// reached only by Revenue Confirm (daily close); Void/Reopen are separate gated
// actions.
const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ['open'],
  open: ['in_service'],
  in_service: ['completed'],
};

export async function setOrderStatus(orderId: string, next: string): Promise<ActionResult> {
  const session = await currentSession();
  const supabase = createServiceClient();
  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('status, total_cents, paid_cents')
    .eq('id', orderId)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  const allowed = ALLOWED_NEXT[order.status] ?? [];
  if (!allowed.includes(next)) {
    return { ok: false, error: `Cannot move from ${order.status} to ${next}` };
  }
  const { error } = await supabase.from('orders').update({ status: next }).eq('id', orderId);
  if (error) return { ok: false, error: error.message };
  await logStatus(orderId, order.status, next, null, session?.staffUserId ?? null);
  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

const paymentSchema = z.object({
  order_id: z.string().uuid(),
  order_customer_id: z.string().uuid().optional().nullable(),
  payment_method_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_ref: z.string().max(80).optional().nullable(),
  stored_value_card_id: z.string().uuid().optional().nullable(),
  tips: z
    .array(
      z.object({
        order_item_id: z.string().uuid(),
        therapist_id: z.string().uuid(),
        amount: z.coerce.number().positive(),
      }),
    )
    .optional(),
});

export async function takePayment(input: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();
  const amountCents = Math.round(d.amount * 100);

  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('total_cents, paid_cents, status')
    .eq('id', d.order_id)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is already closed or void' };
  }

  const { data: method } = await supabase
    .from('payment_methods')
    .select('code')
    .eq('id', d.payment_method_id)
    .single();

  // Tips ride a non-cash payment (PAYMAYA, or a stored-value redemption where the
  // tip itself is charged via PAYMAYA). Cash tips never enter the system.
  const tips = d.tips ?? [];
  if (tips.length > 0 && !['paymaya', 'stored_value_card'].includes(method?.code ?? '')) {
    return { ok: false, error: 'Tips can only be recorded on a PAYMAYA or stored-value payment' };
  }

  // Stored-value redemption: deduct the card balance and ledger the consume.
  let svcCard: { id: string; current_balance_cents: number; branch_id: string; status: string } | null = null;
  if (method?.code === 'stored_value_card') {
    if (!d.stored_value_card_id) return { ok: false, error: 'Select a stored value card' };
    const { data: card } = await supabase
      .from('stored_value_cards')
      .select('id, current_balance_cents, branch_id, status')
      .eq('id', d.stored_value_card_id)
      .single();
    if (!card) return { ok: false, error: 'Card not found' };
    if (card.status !== 'active') return { ok: false, error: 'Card is not active' };
    if (card.current_balance_cents < amountCents) return { ok: false, error: 'Insufficient card balance' };
    svcCard = card;
  }

  const { data: payment, error: pe } = await supabase
    .from('payments')
    .insert({
      order_id: d.order_id,
      order_customer_id: d.order_customer_id || null,
      payment_method_id: d.payment_method_id,
      amount_cents: amountCents,
      payment_ref: d.payment_ref || null,
      stored_value_card_id: svcCard?.id ?? null,
      paid_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (pe || !payment) return { ok: false, error: pe?.message ?? 'Payment insert failed' };

  if (svcCard) {
    const balanceAfter = svcCard.current_balance_cents - amountCents;
    const session = await currentSession();
    await supabase
      .from('stored_value_cards')
      .update({ current_balance_cents: balanceAfter, status: balanceAfter === 0 ? 'depleted' : 'active' })
      .eq('id', svcCard.id);
    await supabase.from('stored_value_transactions').insert({
      card_id: svcCard.id,
      branch_id: svcCard.branch_id,
      type: 'consume',
      amount_cents: -amountCents,
      balance_after_cents: balanceAfter,
      related_order_id: d.order_id,
      related_payment_id: payment.id,
      approved_by_user_id: session?.staffUserId ?? null,
    });
  }

  if (tips.length > 0) {
    const { error: te } = await supabase.from('tips').insert(
      tips.map((t) => ({
        order_id: d.order_id,
        order_item_id: t.order_item_id,
        therapist_id: t.therapist_id,
        payment_id: payment.id,
        amount_cents: Math.round(t.amount * 100),
        status: 'open',
      })),
    );
    if (te) return { ok: false, error: te.message };
  }

  const newPaid = order.paid_cents + amountCents;
  const patch: { paid_cents: number; status?: string } = { paid_cents: newPaid };
  // Auto-advance to paid when fully covered (from completed or earlier).
  if (newPaid >= order.total_cents && order.total_cents > 0 && order.status !== 'paid') {
    patch.status = 'paid';
  }
  const { error: ue } = await supabase.from('orders').update(patch).eq('id', d.order_id);
  if (ue) return { ok: false, error: ue.message };

  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

// Reverse a recorded payment: drop it (and its open tips), refund the order's
// paid total, and step a fully-paid order back to completed if it no longer is.
export async function voidPayment(paymentId: string, orderId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('status, total_cents')
    .eq('id', orderId)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is locked — reopen is not possible' };
  }
  // Once the order is fully paid, removing a payment needs manager authority.
  if (order.status === 'paid' && !isManager(await currentSession())) {
    return { ok: false, error: 'Manager permission required to remove a payment from a paid order' };
  }

  const { data: settled } = await supabase
    .from('tips')
    .select('id')
    .eq('payment_id', paymentId)
    .not('settlement_id', 'is', null);
  if (settled && settled.length > 0) {
    return { ok: false, error: 'A tip on this payment is already settled; cannot void it' };
  }

  await supabase.from('tips').delete().eq('payment_id', paymentId);
  const { error: de } = await supabase.from('payments').delete().eq('id', paymentId);
  if (de) return { ok: false, error: de.message };

  const { data: remaining } = await supabase
    .from('payments')
    .select('amount_cents')
    .eq('order_id', orderId);
  const paid = (remaining ?? []).reduce((s, p) => s + p.amount_cents, 0);
  const patch: { paid_cents: number; status?: string } = { paid_cents: paid };
  if (order.status === 'paid' && paid < order.total_cents) patch.status = 'completed';
  const { error: ue } = await supabase.from('orders').update(patch).eq('id', orderId);
  if (ue) return { ok: false, error: ue.message };

  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}
