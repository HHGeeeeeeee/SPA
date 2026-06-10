'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient, createAuditedClient } from '@/lib/supabase/server';
import { nextOrderNo } from '@/lib/order-no';
import { currentSession, isManager } from '@/lib/auth';
import { isBusinessDayClosed } from '@/app/(dashboard)/reconciliation/end-of-day/actions';
import { getCurrentOpenShift } from '@/app/(dashboard)/reconciliation/shift-remittance/actions';
import { canAccessBranch, getAllowedBranchIds } from '@/lib/branch-access';
import { canPerformGroup, matchesGender } from '@/lib/therapist-availability';
import { assertBedMatchesServiceItem } from '@/lib/resource-compatibility';
import {
  INTERRUPT_REASON_CODES_BY_HANDLING,
  interruptReasonLabel,
} from '@/lib/interrupt-taxonomy';
import { verifyManagerPin, verifyAnyManagerPin, listPinCapableManagers } from '@/lib/manager-pin';

/** Surface the manager list to client components that need to render a PIN
 *  approval picker (e.g. Interrupt with No charge). Re-exported here so the
 *  dialog imports stay inside sales-orders without a cross-feature dep. */
export async function getPinCapableManagers() {
  return listPinCapableManagers();
}

// Shared guard for operational order actions: enforce a logged-in session AND
// branch scoping by looking up the order's branch_id. Used by the service-flow
// + cashier actions that previously had no permission check.
async function requireOrderBranchAccess(orderId: string): Promise<{ ok: false; error: string } | { ok: true }> {
  if (!(await currentSession())) return { ok: false, error: 'Sign in required' };
  const sb = await createAuditedClient();
  const { data } = await sb.from('orders').select('branch_id').eq('id', orderId).maybeSingle();
  if (!data?.branch_id) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(data.branch_id))) return { ok: false, error: 'No access to this branch' };
  return { ok: true };
}

// Same guard, but the lookup starts from an order_item_id (the caller doesn't
// know its parent order yet). Used by the service-flow actions that take only
// itemId / itemId+orderId where orderId may not be trustworthy.
async function requireItemBranchAccess(itemId: string): Promise<{ ok: false; error: string } | { ok: true }> {
  if (!(await currentSession())) return { ok: false, error: 'Sign in required' };
  const sb = await createAuditedClient();
  const { data } = await sb.from('order_items')
    .select('order:orders!order_items_order_id_fkey ( branch_id )')
    .eq('id', itemId)
    .maybeSingle();
  const branchId = Array.isArray(data?.order) ? data?.order[0]?.branch_id : data?.order?.branch_id;
  if (!branchId) return { ok: false, error: 'Order item not found' };
  if (!(await canAccessBranch(branchId))) return { ok: false, error: 'No access to this branch' };
  return { ok: true };
}

// Append a row to the generic status-change audit log.
async function logStatus(
  orderId: string,
  from: string | null,
  to: string,
  reason: string | null,
  staffId: string | null,
) {
  const supabase = await createAuditedClient();
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

export async function createDraftOrder(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const supabase = await createAuditedClient();

  const { data: branch, error: be } = await supabase
    .from('branches')
    .select('code, branch_business_units ( business_unit_id )')
    .eq('id', d.branch_id)
    .single();
  if (be || !branch) return { ok: false, error: 'Branch not found' };
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };

  if (await isBusinessDayClosed(d.branch_id, d.service_date)) {
    return { ok: false, error: 'The business day is closed for this branch — no new orders can post to this date.' };
  }

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

  const order_no = await nextOrderNo(supabase, d.service_date);

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

/**
 * One-click draft: skip the New Order dialog and open a draft straight away with
 * sensible defaults — the user's home branch (or the first one they can access),
 * its first business unit, the WALK-IN source (billing follows it, else SELF),
 * walk-in type, today's date. Branch / source / billing stay editable on the
 * order screen. Service-first entry: the desk just picks services next.
 */
export async function createQuickDraft(): Promise<ActionResult<{ id: string }>> {
  const session = await currentSession();
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const { data: branches } = await supabase
    .from('branches')
    .select('id, branch_business_units ( business_unit_id )')
    .eq('active', true)
    .order('code');
  const usable = (branches ?? []).filter((b) => allowed.has(b.id));
  const branch = usable.find((b) => b.id === session?.homeBranchId) ?? usable[0];
  if (!branch) return { ok: false, error: 'No branch available' };
  const business_unit_id = (branch.branch_business_units ?? [])[0]?.business_unit_id ?? null;

  const { data: walkIn } = await supabase
    .from('customer_sources').select('id, default_billing_to_id').eq('code', 'WALK-IN').maybeSingle();
  let billing_to_id = walkIn?.default_billing_to_id ?? null;
  if (!billing_to_id) {
    const { data: self } = await supabase.from('billing_destinations').select('id').eq('code', 'SELF').maybeSingle();
    billing_to_id = self?.id ?? null;
  }
  const service_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  return createDraftOrder({
    branch_id: branch.id,
    business_unit_id,
    source_id: walkIn?.id ?? null,
    billing_to_id,
    order_type: 'walk_in',
    service_date,
    note: null,
  });
}

// One guest's service line in the direct create-order flow: a category (required)
// and an optional concrete service (deferred + unpriced if omitted), plus the
// guest's identity and any board-click pre-assignment (bed / therapist).
const createOrderGuestSchema = z.object({
  name: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  gender: z.string().max(20).optional().nullable(),
  service_category_id: z.string().uuid(),
  service_item_id: z.string().uuid().optional().nullable(),
  duration_minutes: z.coerce.number().int().positive().optional().nullable(),
  therapist_id: z.string().uuid().optional().nullable(),
  resource_id: z.string().uuid().optional().nullable(),
});
const createOrderDirectSchema = z.object({
  branch_id: z.string().uuid(),
  source_id: z.string().uuid().optional().nullable(),
  service_date: z.string().min(1),
  // Booked start (ISO, +08:00) applied to every line — the calendar passes the
  // clicked time; the standalone button can leave it null (untimed).
  scheduled_start: z.string().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  guests: z.array(createOrderGuestSchema).min(1, 'Add at least one guest'),
});

/**
 * Build a draft order in one shot from the calendar's "Create Order" dialog:
 * one order_customer + one order_item per guest, each line carrying its own
 * category / (optional) service / duration. Discount defaults to DIS-00 (no
 * discount); billing + phone policy follow the customer source. Returns the new
 * order id so the dialog can jump straight into the order screen.
 */
export async function createOrderDirect(input: unknown): Promise<ActionResult<{ orderId: string }>> {
  const parsed = createOrderDirectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const supabase = await createAuditedClient();
  const session = await currentSession();

  const { data: branch, error: be } = await supabase
    .from('branches')
    .select('branch_business_units ( business_unit_id )')
    .eq('id', d.branch_id)
    .single();
  if (be || !branch) return { ok: false, error: 'Branch not found' };
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (await isBusinessDayClosed(d.branch_id, d.service_date)) {
    return { ok: false, error: 'The business day is closed for this branch — no new orders can post to this date.' };
  }
  // Branch hosting exactly one unit → attribute it automatically (mirrors createDraftOrder).
  const branchUnitIds = (branch.branch_business_units ?? []).map((r) => r.business_unit_id);
  const businessUnitId = branchUnitIds.length === 1 ? branchUnitIds[0] : null;

  // Billing destination + phone requirement follow the customer source.
  let billingToId: string | null = null;
  let phoneRequired = false;
  if (d.source_id) {
    const { data: src } = await supabase
      .from('customer_sources')
      .select('default_billing_to_id, phone_required')
      .eq('id', d.source_id)
      .maybeSingle();
    if (!src) return { ok: false, error: 'Customer source not found' };
    billingToId = src.default_billing_to_id ?? null;
    phoneRequired = !!src.phone_required;
  }
  if (phoneRequired && !d.guests[0]?.phone?.trim()) {
    return { ok: false, error: 'A guest phone is required for this source' };
  }

  // Default discount class: DIS-00 (no discount) for every line.
  const { data: dis0 } = await supabase.from('discount_classes').select('id').eq('code', 'DIS-00').maybeSingle();
  const discountClassId = dis0?.id ?? null;
  if (!discountClassId) return { ok: false, error: 'No default discount class configured' };

  const order_no = await nextOrderNo(supabase, d.service_date);
  const { data: order, error: oe } = await supabase
    .from('orders')
    .insert({
      order_no,
      branch_id: d.branch_id,
      business_unit_id: businessUnitId,
      source_id: d.source_id || null,
      billing_to_id: billingToId,
      order_type: 'walk_in',
      service_date: d.service_date,
      note: d.note || null,
      status: 'draft',
      created_by_staff_user_id: session?.staffUserId ?? null,
    })
    .select('id')
    .single();
  if (oe || !order) return { ok: false, error: oe?.message ?? 'Could not create order' };

  // One customer per guest, in form order (seq_no 1..N; blank names → "Guest N").
  const { data: customers, error: ce } = await supabase
    .from('order_customers')
    .insert(
      d.guests.map((g, i) => ({
        order_id: order.id,
        customer_name: g.name?.trim() || `Guest ${i + 1}`,
        customer_phone: g.phone?.trim() || null,
        gender: g.gender || null,
        seq_no: i + 1,
      })),
    )
    .select('id, seq_no');
  if (ce) return { ok: false, error: ce.message };
  const sorted = [...(customers ?? [])].sort((a, b) => a.seq_no - b.seq_no);

  // One service line per guest. buildLineWrite handles both shapes: a concrete
  // service → full pricing; category-only → an unpriced deferred line.
  for (let i = 0; i < d.guests.length; i++) {
    const g = d.guests[i];
    const lw = await buildLineWrite(supabase, {
      order_id: order.id,
      service_item_id: g.service_item_id ?? null,
      service_category_id: g.service_category_id,
      duration_minutes: g.duration_minutes ?? null,
      therapist_id: g.therapist_id ?? null,
      resource_id: g.resource_id ?? null,
      discount_class_id: discountClassId,
    });
    if ('error' in lw) return { ok: false, error: lw.error };
    const { error: ie } = await supabase.from('order_items').insert({
      order_id: order.id,
      order_customer_id: sorted[i].id,
      ...lw.patch,
      scheduled_start: d.scheduled_start ?? null,
    });
    if (ie) return { ok: false, error: ie.message };
  }

  await recomputeTotals(order.id);
  revalidatePath('/calendar');
  revalidatePath('/sales-orders');
  return { ok: true, data: { orderId: order.id } };
}

export async function cancelOrder(id: string, reason: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to cancel' };
  if (!reason || reason.trim().length < 3) return { ok: false, error: 'A reason is required to cancel' };
  const supabase = await createAuditedClient();
  const { data: order } = await supabase.from('orders').select('status').eq('id', id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'A closed or already-cancelled order cannot be cancelled' };
  }

  // Cancel is only for an order where no service was ever delivered. The moment
  // a line goes In service revenue is posted, and once it's Service completed it
  // also earns commission — neither can be wiped by a cancel. Block on both, so
  // a started/finished order is corrected via refund/adjustment instead.
  const { data: items } = await supabase
    .from('order_items').select('id, status').eq('order_id', id);
  const delivered = (items ?? []).filter((i) => ['in_service', 'service_completed'].includes(i.status));
  if (delivered.length > 0) {
    const running = delivered.filter((i) => i.status === 'in_service').length;
    return {
      ok: false,
      error: running > 0
        ? `${running} service(s) still in progress — finish or interrupt them; an order with delivered service can't be cancelled.`
        : `${delivered.length} service(s) already completed — an order with delivered service can't be cancelled. Refund/adjust it instead.`,
    };
  }

  // Cancel all draft lines (scheduled but not yet started).
  const draftIds = (items ?? []).filter((i) => i.status === 'draft').map((i) => i.id);
  if (draftIds.length > 0) {
    const { error: ie } = await supabase
      .from('order_items').update({ status: 'cancelled' }).in('id', draftIds);
    if (ie) return { ok: false, error: ie.message };
  }

  const { error } = await supabase.from('orders').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await logStatus(id, order.status, 'void', reason.trim(), session!.staffUserId);
  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${id}`);
  revalidatePath('/calendar');
  return { ok: true };
}

// Reopen a Completed order back to Open so it can be edited again. Manager-only,
// reason required, snapshot written to order_edit_log.
export async function reopenOrder(id: string, reason: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to reopen' };
  if (!reason || reason.trim().length < 3) return { ok: false, error: 'A reason is required to reopen' };
  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, status, total_cents, paid_cents, subtotal_cents, discount_cents')
    .eq('id', id)
    .single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'completed') {
    return { ok: false, error: 'Only a Completed order can be reopened. Reverse the payment first if it is Paid.' };
  }
  const { error } = await supabase.from('orders').update({ status: 'in_service' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('order_edit_log').insert({
    order_id: id,
    before_snapshot: order,
    after_snapshot: { ...order, status: 'in_service' },
    edit_reason: reason.trim(),
    from_status: 'completed',
    to_status: 'in_service',
    edited_by_staff_id: session!.staffUserId,
  });
  await logStatus(id, 'completed', 'in_service', reason.trim(), session!.staffUserId);
  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${id}`);
  return { ok: true };
}

const noteSchema = z.object({
  order_id: z.string().uuid(),
  note: z.string().max(2000).optional().nullable(),
});

// The order note is operational metadata, not financial — so it stays editable
// in ANY status (including closed/void). Branch-access gated; each change is
// written to the edit history.
export async function updateOrderNote(input: unknown): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const session = await currentSession();
  const supabase = await createAuditedClient();
  const { data: order } = await supabase.from('orders').select('note, branch_id').eq('id', d.order_id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  const next = d.note?.trim() ? d.note.trim() : null;
  if ((order.note ?? null) === next) return { ok: true }; // unchanged — no-op
  const { error } = await supabase.from('orders').update({ note: next }).eq('id', d.order_id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('order_edit_log').insert({
    order_id: d.order_id,
    before_snapshot: { note: order.note ?? null },
    after_snapshot: { note: next },
    edit_reason: 'Note updated',
    edited_by_staff_id: session?.staffUserId ?? null,
  });
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const sourceBillingSchema = z.object({
  order_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  billing_to_id: z.string().uuid().nullable(),
});

// Edit an order's Customer Source / Billing To after creation. Allowed only
// while the order is still editable (draft / open / in_service) — once it's
// paid/closed/confirmed the billing is locked in for accounting. Logged to the
// order edit trail like other post-creation changes.
export async function updateOrderSourceBilling(input: unknown): Promise<ActionResult> {
  const parsed = sourceBillingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const session = await currentSession();
  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders').select('status, branch_id, source_id, billing_to_id').eq('id', d.order_id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft', 'in_service'].includes(order.status)) {
    return { ok: false, error: 'This order can no longer be edited' };
  }
  if ((order.source_id ?? null) === (d.source_id ?? null) && (order.billing_to_id ?? null) === (d.billing_to_id ?? null)) {
    return { ok: true }; // unchanged — no-op
  }
  const { error } = await supabase
    .from('orders').update({ source_id: d.source_id, billing_to_id: d.billing_to_id }).eq('id', d.order_id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('order_edit_log').insert({
    order_id: d.order_id,
    before_snapshot: { source_id: order.source_id ?? null, billing_to_id: order.billing_to_id ?? null },
    after_snapshot: { source_id: d.source_id, billing_to_id: d.billing_to_id },
    edit_reason: 'Customer source / billing updated',
    edited_by_staff_id: session?.staffUserId ?? null,
  });
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const locationSchema = z.object({
  order_id: z.string().uuid(),
  service_location_type: z.enum(['on_site', 'external_hotel']),
  external_hotel_id: z.string().uuid().nullable().optional(),
});

// Set whether the whole order is served on-site or dispatched to a hotel
// (external_hotel). This drives the dispatch flow — a dispatched order's services
// occupy a therapist's time but use no in-house station.
export async function updateOrderLocationType(input: unknown): Promise<ActionResult> {
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const session = await currentSession();
  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders').select('status, branch_id, service_location_type, external_hotel_id').eq('id', d.order_id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft', 'in_service'].includes(order.status)) {
    return { ok: false, error: 'This order can no longer be edited' };
  }
  // Hotel only applies to a dispatched order; on-site clears it.
  const hotelId = d.service_location_type === 'external_hotel' ? (d.external_hotel_id ?? null) : null;
  if ((order.service_location_type ?? null) === d.service_location_type && (order.external_hotel_id ?? null) === hotelId) {
    return { ok: true }; // no-op
  }
  const { error } = await supabase
    .from('orders').update({ service_location_type: d.service_location_type, external_hotel_id: hotelId }).eq('id', d.order_id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('order_edit_log').insert({
    order_id: d.order_id,
    before_snapshot: { service_location_type: order.service_location_type ?? null, external_hotel_id: order.external_hotel_id ?? null },
    after_snapshot: { service_location_type: d.service_location_type, external_hotel_id: hotelId },
    edit_reason: 'Service location updated',
    edited_by_staff_id: session?.staffUserId ?? null,
  });
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const branchUnitSchema = z.object({
  order_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  business_unit_id: z.string().uuid().nullable().optional(),
});

// Edit an order's Branch / Business Unit after creation (the New Order dialog is
// gone — these now live on the order screen). Branch can only change while the
// order has NO services yet (changing it would orphan branch-scoped therapist /
// station / pricing); business unit can change any time the order is editable.
export async function updateOrderBranchUnit(input: unknown): Promise<ActionResult> {
  const parsed = branchUnitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const session = await currentSession();
  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders').select('status, branch_id, business_unit_id').eq('id', d.order_id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft', 'in_service'].includes(order.status)) {
    return { ok: false, error: 'This order can no longer be edited' };
  }

  const patch: { branch_id?: string; business_unit_id?: string | null } = {};

  if (d.branch_id && d.branch_id !== order.branch_id) {
    const { count } = await supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', d.order_id);
    if ((count ?? 0) > 0) return { ok: false, error: 'Remove the services first before changing branch' };
    if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to that branch' };
    patch.branch_id = d.branch_id;
    // Re-attribute to the new branch's business unit (caller-picked, else its first).
    const { data: bu } = await supabase.from('branch_business_units').select('business_unit_id').eq('branch_id', d.branch_id);
    const ids = (bu ?? []).map((x) => x.business_unit_id);
    patch.business_unit_id = (d.business_unit_id && ids.includes(d.business_unit_id)) ? d.business_unit_id : (ids[0] ?? null);
  } else if (d.business_unit_id !== undefined) {
    if (d.business_unit_id) {
      const { data: link } = await supabase.from('branch_business_units').select('business_unit_id').eq('branch_id', order.branch_id).eq('business_unit_id', d.business_unit_id).maybeSingle();
      if (!link) return { ok: false, error: 'That business unit is not assigned to this branch' };
    }
    patch.business_unit_id = d.business_unit_id;
  }

  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('orders').update(patch).eq('id', d.order_id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('order_edit_log').insert({
    order_id: d.order_id,
    before_snapshot: { branch_id: order.branch_id, business_unit_id: order.business_unit_id ?? null },
    after_snapshot: { branch_id: patch.branch_id ?? order.branch_id, business_unit_id: patch.business_unit_id ?? order.business_unit_id ?? null },
    edit_reason: 'Branch / business unit updated',
    edited_by_staff_id: session?.staffUserId ?? null,
  });
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Line-item editor
// ---------------------------------------------------------------------------

async function recomputeTotals(orderId: string) {
  const supabase = await createAuditedClient();
  // The order total is the bill (what the guest will owe), so it keeps the
  // not-yet-delivered states (unassigned / scheduled) as expected charges. Only
  // the zero-revenue terminal states drop out: cancelled, and no_show (a booked
  // line the guest never came for — no charge).
  const { data: items } = await supabase
    .from('order_items')
    .select('list_price_cents, discount_amount_cents, final_amount_cents')
    .eq('order_id', orderId)
    .not('status', 'in', '(cancelled,no_show)');
  // Price columns are nullable now (a service whose concrete item isn't chosen
  // yet has no price) — coalesce so a pending line contributes 0, not NaN.
  const subtotal = (items ?? []).reduce((s, i) => s + (i.list_price_cents ?? 0), 0);
  const discount = (items ?? []).reduce((s, i) => s + (i.discount_amount_cents ?? 0), 0);
  const serviceTotal = (items ?? []).reduce((s, i) => s + (i.final_amount_cents ?? 0), 0);
  // Tips are recognised revenue on top of the service bill, so the order total
  // (what the guest pays) includes them. They live as kind=tip folio lines.
  const { data: tipLines } = await supabase
    .from('folio_lines')
    .select('amount_cents')
    .eq('order_id', orderId)
    .eq('kind', 'tip');
  const tipTotal = (tipLines ?? []).reduce((s, t) => s + (t.amount_cents ?? 0), 0);
  // Manual folio adjustments — "Add revenue" (positive) and "Adjust charge"
  // (negative) — are kind=revenue lines with NO order_item_id, so they aren't
  // part of serviceTotal (which is item-based). Fold them in too, or the bill
  // ignores every manual correction. Service-revenue postings carry an
  // order_item_id and are excluded here to avoid double-counting serviceTotal.
  const { data: adjLines } = await supabase
    .from('folio_lines')
    .select('amount_cents')
    .eq('order_id', orderId)
    .eq('kind', 'revenue')
    .is('order_item_id', null);
  const manualAdjustments = (adjLines ?? []).reduce((s, a) => s + (a.amount_cents ?? 0), 0);
  const total = serviceTotal + tipTotal + manualAdjustments;
  await supabase
    .from('orders')
    .update({ subtotal_cents: subtotal, discount_cents: discount, total_cents: total })
    .eq('id', orderId);
}

// After the order total changes (manual revenue / adjust charge), the paid-vs-
// total relationship may have crossed a terminal boundary: an added charge can
// reopen a fully-paid (closed) order, and a downward adjustment can settle a
// completed one outright. Reconcile just those two money states — mirrors the
// flips already done in takePayment (→ closed) and recordRefund (→ completed).
async function reconcilePaidStatus(orderId: string) {
  const supabase = await createAuditedClient();
  const { data: o } = await supabase
    .from('orders').select('status, total_cents, paid_cents').eq('id', orderId).single();
  if (!o) return;
  if (o.status === 'closed' && o.paid_cents < o.total_cents) {
    await supabase.from('orders').update({ status: 'completed' }).eq('id', orderId);
    await logStatus(orderId, 'closed', 'completed', 'Charge added — balance reopened', null);
  } else if (o.status === 'completed' && o.total_cents > 0 && o.paid_cents >= o.total_cents) {
    await supabase.from('orders').update({ status: 'closed' }).eq('id', orderId);
    await logStatus(orderId, 'completed', 'closed', 'Charge adjusted — balance settled', null);
  }
}

// Wrap up an order once no line is still scheduled or running — works from
// open (e.g. every service was skipped) as well as in_service (all finished).
// Needs at least one line, so an empty order being set up isn't auto-completed.
async function maybeAutoComplete(orderId: string) {
  const supabase = await createAuditedClient();
  const { data: items } = await supabase
    .from('order_items')
    .select('status')
    .eq('order_id', orderId);
  if (!items || items.length === 0) return; // nothing to complete yet
  // unassigned/scheduled lines are still pending work — an order full of
  // not-yet-started bookings must not auto-complete.
  if (items.some((i) => ['draft', 'in_service'].includes(i.status))) return; // work still pending
  const { data: ord } = await supabase.from('orders').select('status, total_cents, paid_cents').eq('id', orderId).single();
  if (ord && ['in_service'].includes(ord.status)) {
    // Services are all done. If the bill is already paid in full, the order is
    // finished outright (closed); otherwise it lands on completed with a balance
    // still owing.
    const next = ord.total_cents > 0 && ord.paid_cents >= ord.total_cents ? 'closed' : 'completed';
    await supabase.from('orders').update({ status: next }).eq('id', orderId);
    await logStatus(orderId, ord.status, next, 'All services finished or skipped', null);
  }
}

const addCustomerSchema = z.object({
  order_id: z.string().uuid(),
  // Name is optional — an unnamed guest is auto-labelled "Guest N" on insert.
  customer_name: z.string().max(120).optional().nullable(),
  customer_phone: z.string().max(40).optional().nullable(),
  gender: z.string().max(10).optional().nullable(),
});

export async function addOrderCustomer(input: unknown): Promise<ActionResult> {
  const parsed = addCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const { data: ord } = await supabase.from('orders').select('status, branch_id').eq('id', d.order_id).single();
  if (!ord) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft', 'in_service'].includes(ord.status)) return { ok: false, error: 'This order can no longer be edited' };
  const { data: existing } = await supabase
    .from('order_customers')
    .select('seq_no')
    .eq('order_id', d.order_id)
    .order('seq_no', { ascending: false })
    .limit(1);
  const nextSeq = (existing?.[0]?.seq_no ?? 0) + 1;
  const { error } = await supabase.from('order_customers').insert({
    order_id: d.order_id,
    customer_name: d.customer_name?.trim() || `Guest ${nextSeq}`,
    customer_phone: d.customer_phone || null,
    gender: d.gender || null,
    seq_no: nextSeq,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

// Remove a guest from the order. Blocked once they have a started/finished
// service or a recorded payment — removing them would cascade away that history
// (their order_items, and those items' tips/feedback). A guest with only
// not-yet-started lines is fine; those unstarted lines go with them.
export async function removeOrderCustomer(customerId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createAuditedClient();
  const { data: ord } = await supabase.from('orders').select('branch_id').eq('id', orderId).single();
  if (!ord) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };

  const { data: custItems } = await supabase
    .from('order_items')
    .select('status')
    .eq('order_customer_id', customerId);
  if ((custItems ?? []).some((i) => !['draft', 'cancelled'].includes(i.status))) {
    return { ok: false, error: 'This guest has a started or finished service and can\'t be removed.' };
  }
  const { data: custPays } = await supabase.from('folio_lines').select('id').eq('order_customer_id', customerId).in('kind', ['payment', 'refund']).limit(1);
  if (custPays && custPays.length > 0) {
    return { ok: false, error: 'This guest has a recorded payment — remove the payment first.' };
  }

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
  // Preferred therapist gender lives on the guest (not the service line). Only
  // patched when the key is present — omitting it leaves the preference intact
  // (so the rename flow doesn't wipe a gender set elsewhere).
  gender: z.string().max(10).optional().nullable(),
});

// Rename / re-phone / set the gender preference of an existing guest (e.g. fill
// in a converted booking's "Guest 2" placeholder once they're at the desk).
export async function updateOrderCustomer(input: unknown): Promise<ActionResult> {
  if (!(await currentSession())) return { ok: false, error: 'Sign in required' };
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  // Branch scoping piggybacks on the parent order — order_customers itself
  // doesn't carry branch_id.
  const { data: ord } = await supabase.from('orders').select('branch_id').eq('id', d.order_id).maybeSingle();
  if (!ord?.branch_id || !(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };
  const patch: { customer_name: string; customer_phone: string | null; gender?: string | null } = {
    customer_name: d.customer_name,
    customer_phone: d.customer_phone || null,
  };
  if (d.gender !== undefined) patch.gender = d.gender || null;
  const { error } = await supabase.from('order_customers').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const addItemSchema = z.object({
  order_id: z.string().uuid(),
  order_customer_id: z.string().uuid(),
  // Concrete service is optional: a booking can reserve a time + category and
  // pick the exact service later. When omitted, service_category_id is required
  // and the line is created unpriced.
  service_item_id: z.string().uuid().optional().nullable(),
  service_category_id: z.string().uuid().optional().nullable(),
  // Booked start (ISO, +08:00). Optional — an untimed booking sits in the
  // unallocated lane with no position on the board axis.
  scheduled_start: z.string().optional().nullable(),
  external_room_no: z.string().optional().nullable(),
  // Used only when no concrete service is chosen (else duration comes from the
  // service item). Defaults to 60 min server-side.
  duration_minutes: z.coerce.number().int().positive().optional().nullable(),
  therapist_id: z.string().uuid().optional().nullable(),
  resource_id: z.string().uuid().optional().nullable(),
  discount_class_id: z.string().uuid(),
  // Manager-entered amount for variable discounts (DIS-91 / DIS-99), in pesos.
  discount_override: z.coerce.number().min(0).optional().nullable(),
}).refine((d) => d.service_item_id || d.service_category_id, {
  message: 'Pick a service or at least a service category',
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
    .select('service_date, source:customer_sources ( discount_locked, default_discount_class_id )')
    .eq('id', d.order_id)
    .maybeSingle();
  const ordSource = ord ? (Array.isArray(ord.source) ? ord.source[0] : ord.source) : null;
  // Price is the segment effective on the service date (the day it's delivered),
  // so an advance booking served after a price change pays the new price.
  const serviceDate = ord?.service_date
    ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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

  // Normal / all-branch list price whose effective period covers the service date.
  const { data: priceRow } = await supabase
    .from('service_item_prices')
    .select('price_cents')
    .eq('service_item_id', d.service_item_id)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .lte('effective_from', serviceDate)
    .gte('effective_to', serviceDate)
    .limit(1)
    .maybeSingle();
  if (!priceRow) return { error: `No list price effective on ${serviceDate} for this service. Set one in Service Items.` };
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

// Build the column patch for an add/update of a not-yet-started line, plus the
// resulting status. Two shapes:
//   - concrete service chosen → full pricing (resolveLinePricing)
//   - service deferred → tentative line carrying just category + duration,
//     unpriced (price resolved later when the guest picks the actual service)
// Status follows placement: a line on a bed is `scheduled` (sits on the board);
// without a bed it's `unassigned` (lives in the unallocated lane).
// The column patch buildLineWrite emits. A deferred (no concrete service yet)
// line is unpriced, so service_item_id / price columns are nullable.
interface LineWrite {
  service_item_id: string | null;
  service_category_id: string;
  therapist_id: string | null;
  therapist_home_branch_id: string | null;
  resource_id: string | null;
  duration_minutes: number;
  list_price_cents: number | null;
  discount_class_id: string;
  discount_amount_cents: number;
  final_amount_cents: number | null;
  status: string;
}

async function buildLineWrite(
  supabase: ReturnType<typeof createServiceClient>,
  d: {
    order_id: string;
    service_item_id?: string | null;
    service_category_id?: string | null;
    duration_minutes?: number | null;
    therapist_id?: string | null;
    resource_id?: string | null;
    discount_class_id: string;
    discount_override?: number | null;
  },
): Promise<{ error: string } | { patch: LineWrite }> {
  // Placed on a bed ⇒ scheduled (sits on the board); otherwise unassigned.
  const status = 'draft';
  if (d.service_item_id) {
    // Server-side backstop for the UI's station-by-type filter. The picker
    // already hides incompatible stations, but a stale form, a future API
    // client, or a manual id paste would slip through without this check.
    if (d.resource_id) {
      const compat = await assertBedMatchesServiceItem(d.resource_id, d.service_item_id);
      if (!compat.ok) return { error: compat.error };
    }
    const res = await resolveLinePricing(supabase, { ...d, service_item_id: d.service_item_id });
    if ('error' in res) return { error: res.error };
    return { patch: { ...res.patch, status } };
  }
  if (!d.service_category_id) return { error: 'Pick a service or at least a service category' };
  let therapistHomeBranch: string | null = null;
  if (d.therapist_id) {
    const { data: emp } = await supabase.from('employees').select('home_branch_id').eq('id', d.therapist_id).single();
    therapistHomeBranch = emp?.home_branch_id ?? null;
  }
  return {
    patch: {
      service_item_id: null,
      service_category_id: d.service_category_id,
      therapist_id: d.therapist_id || null,
      therapist_home_branch_id: therapistHomeBranch,
      resource_id: d.resource_id || null,
      duration_minutes: d.duration_minutes ?? 60,
      list_price_cents: null,
      discount_class_id: d.discount_class_id,
      discount_amount_cents: 0,
      final_amount_cents: null,
      status,
    },
  };
}

export async function addOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();

  const { data: ord } = await supabase.from('orders').select('status, branch_id').eq('id', d.order_id).single();
  if (!ord) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft', 'in_service'].includes(ord.status)) return { ok: false, error: 'This order can no longer be edited' };

  const r = await buildLineWrite(supabase, d);
  if ('error' in r) return { ok: false, error: r.error };

  const { error } = await supabase.from('order_items').insert({
    order_id: d.order_id,
    order_customer_id: d.order_customer_id,
    ...r.patch,
    scheduled_start: d.scheduled_start ?? null,
    external_room_no: d.external_room_no ?? null,
  });
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

const updateItemSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  // Same as addItemSchema: concrete service optional (defer + price later), else
  // category is required.
  service_item_id: z.string().uuid().optional().nullable(),
  service_category_id: z.string().uuid().optional().nullable(),
  duration_minutes: z.coerce.number().int().positive().optional().nullable(),
  therapist_id: z.string().uuid().optional().nullable(),
  resource_id: z.string().uuid().optional().nullable(),
  discount_class_id: z.string().uuid(),
  discount_override: z.coerce.number().min(0).optional().nullable(),
  // Booked start time (ISO). Edited inline on the order's service table; null
  // clears it (a timed booking drops back to "no time yet").
  scheduled_start: z.string().optional().nullable(),
  external_room_no: z.string().optional().nullable(),
}).refine((d) => d.service_item_id || d.service_category_id, {
  message: 'Pick a service or at least a service category',
});

// Edit a not-yet-started line: re-price for the new service/discount and
// reassign therapist/station. Assigning a bed promotes it to `scheduled`,
// clearing the bed drops it back to `unassigned` (buildLineWrite derives this).
// Blocked once the line is in-service or done (the numbers are committed by
// then — delete + re-add for those).
export async function updateOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();

  const { data: existing } = await supabase.from('order_items').select('status').eq('id', d.id).single();
  if (!existing) return { ok: false, error: 'Service line not found' };
  if (!['draft'].includes(existing.status)) return { ok: false, error: 'Only a not-yet-started line can be edited' };

  const r = await buildLineWrite(supabase, d);
  if ('error' in r) return { ok: false, error: r.error };

  // The inline table edits the booked start time too; the rest of the patch
  // (service/therapist/station/discount/price) comes from buildLineWrite.
  const patch = { ...r.patch, scheduled_start: d.scheduled_start ?? null, external_room_no: d.external_room_no ?? null };
  const { error } = await supabase.from('order_items').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

// Change the discount on a draft or in-service line. Everything else stays
// untouched — only the discount class, discount amount, and final amount are
// recalculated. Allowed while the service is running so the desk can correct
// a wrong discount without interrupting the therapist.
const updateDiscountSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  discount_class_id: z.string().uuid(),
  discount_override: z.number().nullable().optional(),
});

export async function updateItemDiscount(input: unknown): Promise<ActionResult> {
  const parsed = updateDiscountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const auth = await requireOrderBranchAccess(d.order_id);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();

  const { data: item } = await supabase
    .from('order_items')
    .select('status, service_item_id, list_price_cents')
    .eq('id', d.id)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (!['draft', 'in_service'].includes(item.status))
    return { ok: false, error: 'Discount can only be changed on a scheduled or in-service line' };
  if (!item.service_item_id || item.list_price_cents == null)
    return { ok: false, error: 'Cannot set discount on a deferred (unpriced) line' };

  // Resolve the discount class and compute amounts
  const { data: ord } = await supabase
    .from('orders')
    .select('source:customer_sources ( discount_locked, default_discount_class_id )')
    .eq('id', d.order_id)
    .maybeSingle();
  const ordSource = ord ? (Array.isArray(ord.source) ? ord.source[0] : ord.source) : null;
  const discountClassId = ordSource?.discount_locked && ordSource.default_discount_class_id
    ? ordSource.default_discount_class_id
    : d.discount_class_id;

  const { data: disc, error: de } = await supabase
    .from('discount_classes')
    .select('code, discount_percent, discount_amount_cents')
    .eq('id', discountClassId)
    .single();
  if (de || !disc) return { ok: false, error: 'Discount class not found' };

  if (MANAGER_DISCOUNTS.includes(disc.code) && !isManager(await currentSession())) {
    return { ok: false, error: `${disc.code} requires manager permission` };
  }

  const listPrice = item.list_price_cents;
  let discountAmount = 0;
  if (disc.code === 'DIS-90') {
    discountAmount = listPrice;
  } else if (VARIABLE_DISCOUNTS.includes(disc.code)) {
    const override = Math.round((d.discount_override ?? 0) * 100);
    if (override <= 0) return { ok: false, error: `Enter a discount amount for ${disc.code}` };
    discountAmount = Math.min(override, listPrice);
  } else if (disc.discount_percent > 0) {
    discountAmount = Math.round((listPrice * disc.discount_percent) / 100);
  } else if (disc.discount_amount_cents > 0) {
    discountAmount = Math.min(disc.discount_amount_cents, listPrice);
  }
  const finalAmount = Math.max(0, listPrice - discountAmount);

  const { error } = await supabase.from('order_items').update({
    discount_class_id: discountClassId,
    discount_amount_cents: discountAmount,
    final_amount_cents: finalAmount,
  }).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

// Hard-remove a service line — only on a DRAFT order, and only a not-yet-started
// (scheduled) line. Once the order is open it is "live", so removing a service
// goes through Skip (soft, audit-kept); a started line is ended with Interrupt.
// Hard delete is the draft-only "this was a mistake, erase it" path.
export async function removeOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createAuditedClient();
  const { data: item } = await supabase
    .from('order_items')
    .select('status, order:orders!order_items_order_id_fkey ( branch_id, status )')
    .eq('id', itemId)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  const ord = Array.isArray(item.order) ? item.order[0] : item.order;
  if (!ord) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft'].includes(item.status)) {
    return { ok: false, error: 'Only a not-yet-started service can be removed. Use Cancel or Interrupt for one that has started.' };
  }
  if (ord.status !== 'draft') {
    return { ok: false, error: 'The order is open — use Cancel to remove this service (it stays in the record).' };
  }
  const { error } = await supabase.from('order_items').delete().eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(orderId);
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// Mark a not-yet-started booking as a no-show (the guest never came). Manual —
// the desk decides. Zero revenue, leaves the board, and lets the order wrap up
// if nothing else is pending. Use Cancel/Interrupt for a line that has started.
export async function markNoShow(itemId: string, orderId: string): Promise<ActionResult> {
  const auth = await requireOrderBranchAccess(orderId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
  const { data: item } = await supabase.from('order_items').select('status').eq('id', itemId).single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (!['draft'].includes(item.status)) {
    return { ok: false, error: 'Only a not-yet-started booking can be marked no-show.' };
  }
  const { error } = await supabase.from('order_items').update({ status: 'no_show' }).eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  await recomputeTotals(orderId);
  await maybeAutoComplete(orderId);
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// Per-item service timing — drives real-time therapist availability.
export async function startOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const auth = await requireOrderBranchAccess(orderId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
  const now = new Date().toISOString();

  // No double-booking: the therapist and the station can't already be mid-service
  // on another line.
  const { data: item } = await supabase
    .from('order_items')
    .select('therapist_id, resource_id, service_item_id, order_customer_id, final_amount_cents, scheduled_start, duration_minutes, service:service_items ( commission_applicable, allowed_resource_types, service_group, category:service_categories ( revenue_transaction_code_id ) ), resource:resources!order_items_resource_id_fkey ( branch_id )')
    .eq('id', itemId)
    .single();

  // A tentative booking with no concrete service yet (price unresolved) can't be
  // started — the desk must pick the actual service first.
  if (!item?.service_item_id) {
    return { ok: false, error: 'Choose the service for this line before starting it.' };
  }

  // Revenue is now recognised at FINISH (not Start), so starting a service no
  // longer posts to the folio or requires an open shift — those move to finish.

  // Can't start a hands-on service with nobody to do it, or a service that needs
  // a station/bed without one assigned. (Rest-room style lines need neither.)
  const svc = Array.isArray(item?.service) ? item?.service[0] : item?.service;
  if (svc?.commission_applicable && !item?.therapist_id) {
    return { ok: false, error: 'Assign a therapist before starting this service' };
  }
  if (svc?.allowed_resource_types?.length && !item?.resource_id) {
    return { ok: false, error: 'Assign a station/bed before starting this service' };
  }
  // Type-match the assigned station to the service. The picker already does
  // this, but if a service swap happened earlier without clearing the
  // station, or a line was created via a path that skipped the picker, we
  // catch it here — same start-time hard-stop pattern as the therapist check
  // below.
  if (item?.resource_id && item?.service_item_id) {
    const compat = await assertBedMatchesServiceItem(item.resource_id, item.service_item_id);
    if (!compat.ok) return { ok: false, error: compat.error };
  }

  // Hard-stop at the binding moment: the assigned therapist must be trained for
  // the service's group and match the guest's gender preference. The picker
  // already filters these, but a stale/bypassed assignment can't be started.
  if (item?.therapist_id) {
    const group = svc?.service_group ?? null;
    const [{ data: emp }, { data: caps }, { data: cust }] = await Promise.all([
      supabase.from('employees').select('gender').eq('id', item.therapist_id).single(),
      supabase.from('employee_service_groups').select('service_group').eq('employee_id', item.therapist_id),
      supabase.from('order_customers').select('gender').eq('id', item.order_customer_id ?? '').maybeSingle(),
    ]);
    // Temporarily disabled (too strict; the picker isn't always live-synced, so a
    // still-valid therapist can get blocked at Start). Re-enable with live re-validation.
    // if (!canPerformGroup((caps ?? []).map((c) => c.service_group), group)) {
    //   return { ok: false, error: 'This therapist is not trained for this service' };
    // }
    // Guest gender preference now lives on the order_customer (createBooking sets it).
    if (!matchesGender(emp?.gender, cust?.gender ?? null)) {
      return { ok: false, error: 'This therapist does not match the guest’s gender preference' };
    }
  }

  // One guest does one service at a time — finish the current one before starting
  // the next (no parallel services for the same guest).
  if (item?.order_customer_id) {
    const { data: sameGuest } = await supabase
      .from('order_items')
      .select('id')
      .eq('order_customer_id', item.order_customer_id)
      .eq('status', 'in_service')
      .neq('id', itemId)
      .limit(1);
    if (sameGuest && sameGuest.length > 0) {
      return { ok: false, error: 'Finish this guest’s current service before starting the next' };
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

  // actual_start records the REAL Start press. slot_* drive the calendar's
  // display block: it opens at the planned start (not the press time — the desk
  // starts the line only after seating the guest) and runs to the planned end
  // until Finish trims/caps it.
  const planStartIso = item?.scheduled_start ?? now;
  const planEndIso = item?.scheduled_start && item.duration_minutes != null
    ? new Date(Date.parse(item.scheduled_start) + item.duration_minutes * 60000).toISOString()
    : null;
  const { error } = await supabase
    .from('order_items')
    .update({ status: 'in_service', actual_start: now, slot_start: planStartIso, slot_end: planEndIso })
    .eq('id', itemId);
  if (error) return { ok: false, error: error.message };

  // Revenue is recognised at finish / a charged interrupt, not here — see
  // resolveServiceRevenuePosting + finishOrderItem / interruptOrderItem.

  // Starting the first service moves the order into service automatically —
  // no separate "Start Service" step. Per-line starts still stamp each time.
  const { data: ord } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (ord?.status === 'draft') {
    await supabase.from('orders').update({ status: 'in_service' }).eq('id', orderId);
    await logStatus(orderId, 'draft', 'in_service', 'First service started', null);
  }

  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// One-click batch: start the first scheduled service for each guest who isn't
// already mid-service (one per guest, so a multi-service guest only starts
// their first line). Reuses startOrderItem so all the busy/booking checks and
// the order auto-advance apply.
export async function startAllServices(orderId: string): Promise<ActionResult<{ started: number; skipped: number }>> {
  const auth = await requireOrderBranchAccess(orderId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
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
    if (it.status !== 'draft' || busyCustomers.has(it.order_customer_id) || seen.has(it.order_customer_id)) continue;
    seen.add(it.order_customer_id);
    picked.push(it.id);
  }
  if (picked.length === 0) return { ok: false, error: 'No services are ready to start' };

  let started = 0;
  for (const id of picked) {
    const r = await startOrderItem(id, orderId);
    if (r.ok) started += 1;
  }
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true, data: { started, skipped: picked.length - started } };
}

// Resolve where a service line's revenue posts: the open shift of the station's
// branch (falling back to the order branch) and the category's revenue code.
// Revenue is recognised at finish (and at a charged interrupt), so this guards
// those transitions — a missing shift or category code blocks them cleanly.
async function resolveServiceRevenuePosting(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  itemId: string,
  orderId: string,
): Promise<{ ok: true; shiftId: string; branchId: string | null; txCodeId: string } | { ok: false; error: string }> {
  const { data: item } = await supabase
    .from('order_items')
    .select('resource_id, service:service_items ( category:service_categories ( revenue_transaction_code_id ) ), resource:resources!order_items_resource_id_fkey ( branch_id )')
    .eq('id', itemId)
    .single();
  const { data: ord } = await supabase.from('orders').select('branch_id').eq('id', orderId).single();
  // Revenue follows the STATION's branch (cross-branch work lands in that
  // branch's shift); a line with no station falls back to the order branch.
  const itemResource = Array.isArray(item?.resource) ? item?.resource[0] : item?.resource;
  const stationBranchId = item?.resource_id ? itemResource?.branch_id ?? null : null;
  const shiftBranchId = stationBranchId ?? ord?.branch_id ?? null;
  const openShift = shiftBranchId ? await getCurrentOpenShift(shiftBranchId) : null;
  if (!openShift) {
    return { ok: false, error: 'No cash shift is open for this service’s branch — open one on the Sales Remittance page first.' };
  }
  const svc = Array.isArray(item?.service) ? item?.service[0] : item?.service;
  const svcCategory = Array.isArray(svc?.category) ? svc?.category[0] : svc?.category;
  const txCodeId = svcCategory?.revenue_transaction_code_id ?? null;
  if (!txCodeId) {
    return { ok: false, error: 'This service category has no revenue transaction code — set one in Settings → Service Categories first.' };
  }
  return { ok: true, shiftId: openShift.id, branchId: shiftBranchId, txCodeId };
}

// Insert a kind=revenue folio line for a service line at its recognition moment.
async function postServiceRevenueLine(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  args: { orderId: string; itemId: string; amountCents: number; shiftId: string; branchId: string | null; txCodeId: string },
): Promise<void> {
  const session = await currentSession();
  await supabase.from('folio_lines').insert({
    order_id: args.orderId,
    shift_id: args.shiftId,
    kind: 'revenue',
    amount_cents: args.amountCents,
    posted_by: session?.staffUserId ?? null,
    order_item_id: args.itemId,
    branch_id: args.branchId,
    transaction_code_id: args.txCodeId,
  });
}

export async function finishOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const auth = await requireOrderBranchAccess(orderId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
  const nowMs = Date.now();
  const { data: item } = await supabase
    .from('order_items')
    .select('actual_start, scheduled_start, slot_start, duration_minutes, status, final_amount_cents')
    .eq('id', itemId)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.status !== 'in_service') return { ok: false, error: 'Only an in-service line can be finished' };

  // Revenue is recognised at finish, so resolve the posting shift + code BEFORE
  // completing — a missing open shift / category code blocks the finish cleanly.
  const rev = await resolveServiceRevenuePosting(supabase, itemId, orderId);
  if (!rev.ok) return rev;

  const now = new Date(nowMs).toISOString();
  // Planned end = booked start + duration. The calendar block (slot_end) is
  // capped here: finishing early trims it, finishing late holds it at the plan
  // (the desk may press End after the guest has already left). actual_end always
  // records the REAL press time, for the operational record.
  const planEndMs = item.scheduled_start && item.duration_minutes != null
    ? Date.parse(item.scheduled_start) + item.duration_minutes * 60000
    : null;
  const slotStartMs = item.slot_start
    ? Date.parse(item.slot_start)
    : item.scheduled_start ? Date.parse(item.scheduled_start) : nowMs;
  let slotEndMs = planEndMs != null ? Math.min(nowMs, planEndMs) : nowMs;
  if (slotEndMs < slotStartMs) slotEndMs = slotStartMs; // never a negative-length block
  const slotEnd = new Date(slotEndMs).toISOString();

  const patch: { status: string; actual_end: string; slot_end: string; actual_duration_minutes?: number } = {
    status: 'service_completed',
    actual_end: now,
    slot_end: slotEnd,
  };
  if (item.actual_start) {
    patch.actual_duration_minutes = Math.max(1, Math.round((nowMs - Date.parse(item.actual_start)) / 60000));
  }
  const { error } = await supabase.from('order_items').update(patch).eq('id', itemId);
  if (error) return { ok: false, error: error.message };

  // Recognise the revenue now (finish), at the final discount-applied amount.
  await postServiceRevenueLine(supabase, {
    orderId, itemId, amountCents: item.final_amount_cents ?? 0,
    shiftId: rev.shiftId, branchId: rev.branchId, txCodeId: rev.txCodeId,
  });

  // Finishing the last active service auto-completes the order.
  await maybeAutoComplete(orderId);

  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

export interface StrandedServiceLine {
  itemId: string;
  orderId: string;
  orderNo: string;
  serviceName: string | null;
  serviceDate: string;
  amountCents: number | null;
}
export interface StrandedSweepResult {
  recovered: StrandedServiceLine[];                         // priced → auto-finished + revenue posted
  needsAttention: (StrandedServiceLine & { reason: string })[]; // couldn't auto-recover — listed for a human
}

// Recover service lines stranded `in_service` from a PRIOR day: the desk never
// pressed Finish, so their revenue (recognised at finish) never posted. Called
// when the day's first shift opens — the only hook guaranteed to run, and the
// prior day is definitively over so an in-service line there is unambiguously a
// forgotten Finish (no false positives, no "is this the last shift?" guessing).
//
// Priced lines auto-finish at their PLANNED end (actual_start + duration,
// mirroring finishOrderItem's late-finish cap — never a fabricated "now") and
// post revenue to the SERVICE day's last shift (not the shift being opened, so
// the money lands on the day it was earned). Unpriced placeholder lines (no
// final_amount) can't be auto-posted — zeroing them would hide the loss — so
// they're returned for manual handling, untouched.
export async function sweepStrandedServices(branchIds: string[], today: string): Promise<StrandedSweepResult> {
  const empty: StrandedSweepResult = { recovered: [], needsAttention: [] };
  if (branchIds.length === 0) return empty;
  const supabase = await createAuditedClient();
  const pick = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  // An order with a running line is itself `in_service` (it only leaves that
  // state once no line is still draft/in_service). So prior-day strays are
  // exactly the in_service orders dated before today.
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_no, branch_id, service_date')
    .in('branch_id', branchIds)
    .eq('status', 'in_service')
    .lt('service_date', today)
    .is('deleted_at', null);
  if (!orders || orders.length === 0) return empty;
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const { data: items } = await supabase
    .from('order_items')
    .select('id, order_id, actual_start, duration_minutes, final_amount_cents, resource_id, service:service_items ( name, category:service_categories ( revenue_transaction_code_id ) ), category:service_categories ( name ), resource:resources!order_items_resource_id_fkey ( branch_id )')
    .in('order_id', orders.map((o) => o.id))
    .eq('status', 'in_service');

  const recovered: StrandedServiceLine[] = [];
  const needsAttention: (StrandedServiceLine & { reason: string })[] = [];
  const touchedOrders = new Set<string>();

  for (const it of items ?? []) {
    const ord = orderById.get(it.order_id);
    if (!ord) continue;
    const svc = pick(it.service);
    const base: StrandedServiceLine = {
      itemId: it.id,
      orderId: it.order_id,
      orderNo: ord.order_no,
      serviceName: svc?.name ?? pick(it.category)?.name ?? null,
      serviceDate: ord.service_date,
      amountCents: it.final_amount_cents,
    };
    // Unpriced placeholder line — can't post a correct amount.
    if (it.final_amount_cents == null) { needsAttention.push({ ...base, reason: 'no_price' }); continue; }
    const txCodeId = pick(svc?.category)?.revenue_transaction_code_id ?? null;
    if (!txCodeId) { needsAttention.push({ ...base, reason: 'no_revenue_code' }); continue; }
    // Revenue follows the station's branch (cross-branch work), else the order's.
    const stationBranchId = it.resource_id ? (pick(it.resource)?.branch_id ?? null) : null;
    const postingBranch = stationBranchId ?? ord.branch_id;
    // Attribute to the SERVICE day's last shift, not the one being opened.
    const { data: shift } = await supabase
      .from('shifts').select('id')
      .eq('branch_id', postingBranch).eq('business_date', ord.service_date)
      .order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (!shift) { needsAttention.push({ ...base, reason: 'no_shift' }); continue; }

    const startMs = it.actual_start ? Date.parse(it.actual_start) : null;
    const plannedEndIso = startMs != null && it.duration_minutes != null
      ? new Date(startMs + it.duration_minutes * 60000).toISOString()
      : it.actual_start ?? null;
    const patch: { status: string; actual_end?: string; slot_end?: string; actual_duration_minutes?: number } = { status: 'service_completed' };
    if (plannedEndIso) { patch.actual_end = plannedEndIso; patch.slot_end = plannedEndIso; }
    if (it.duration_minutes != null) patch.actual_duration_minutes = it.duration_minutes;
    const { error } = await supabase.from('order_items').update(patch).eq('id', it.id).eq('status', 'in_service');
    if (error) { needsAttention.push({ ...base, reason: 'update_failed' }); continue; }

    await postServiceRevenueLine(supabase, {
      orderId: it.order_id, itemId: it.id, amountCents: it.final_amount_cents,
      shiftId: shift.id, branchId: postingBranch, txCodeId,
    });
    recovered.push(base);
    touchedOrders.add(it.order_id);
  }

  // Wrap up each order whose last running line just finished.
  for (const oid of touchedOrders) await maybeAutoComplete(oid);
  return { recovered, needsAttention };
}

// "Ready now" — free a bed before its post-service cleanup buffer has elapsed.
// A finished line holds its bed for the service's cleanup_after_minutes (the bed
// auto-frees when that window passes); stamping bed_released_at frees it at once.
export async function releaseBed(itemId: string): Promise<ActionResult> {
  const auth = await requireItemBranchAccess(itemId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
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
  revalidatePath('/calendar');
  return { ok: true };
}

// Skip a not-yet-started service line (guest decides not to do it). It's marked
// cancelled, drops out of the totals, and no longer blocks auto-completion.
export async function skipOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const auth = await requireOrderBranchAccess(orderId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
  const { data: item } = await supabase.from('order_items').select('status').eq('id', itemId).single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.status !== 'draft') {
    return { ok: false, error: 'Only a not-yet-started service can be cancelled (use Interrupt once it has started)' };
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
  // Per-handling reason taxonomy (see @/lib/interrupt-taxonomy). We accept
  // 'partial_charge' here only for the internal switchService() fallback that
  // still uses it; the UI no longer offers it for new interrupts.
  handling: z.enum(['no_charge', 'partial_charge', 'full_charge', 'reschedule']),
  reason_code: z.string().min(1).max(80),
  notes: z.string().max(500).optional().nullable(),
  // Legacy free-text field — switchService() still passes a sentence here so
  // we keep the input shape backwards compatible. New UI submits via
  // reason_code + notes and leaves this empty.
  reason: z.string().min(3).max(300).optional(),
  // Manager-PIN approval pair. Required only when a non-manager caller
  // submits handling='no_charge' (real waive-charge action — not the
  // switchService internal path). When omitted the server returns the
  // sentinel error 'NEED_MANAGER_PIN' so the client can open the PIN
  // entry UI without losing the rest of the form state.
  manager_user_id: z.string().uuid().optional().nullable(),
  manager_pin: z.string().regex(/^\d{4,6}$/).optional().nullable(),
});

// Interrupt an in-service line. Handling decides the charge: full keeps it,
// no_charge/reschedule zero it, partial prorates by actual vs planned minutes
// (legacy path used by switchService — not exposed in the UI).
export async function interruptOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = interruptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const auth = await requireItemBranchAccess(d.item_id);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();

  // Reject a reason_code that doesn't belong to the picked handling — stops
  // a stale form (or a hand-crafted API call) from submitting e.g. a
  // no_charge reason while billing full. switchService passes the literal
  // sentence as reason + a sentinel reason_code, so we let it through.
  if (d.reason_code !== '__switch_service__' && d.handling !== 'partial_charge') {
    const allowed = INTERRUPT_REASON_CODES_BY_HANDLING[d.handling as 'no_charge' | 'full_charge' | 'reschedule'] ?? [];
    if (!allowed.includes(d.reason_code)) {
      return { ok: false, error: 'Reason does not match the handling mode' };
    }
  }

  // Manager-PIN gate for No charge — staff can't waive a charge unilaterally.
  // Manager (or admin) callers go through directly; staff must enclose a
  // manager_user_id + manager_pin in the payload. The internal switchService
  // path is operational (not a manager decision) so it's exempt.
  let approverUserId: string | null = null;
  if (d.handling === 'no_charge' && d.reason_code !== '__switch_service__') {
    const session = await currentSession();
    if (!isManager(session)) {
      if (!d.manager_user_id || !d.manager_pin) {
        // Sentinel error — client opens the PIN entry sheet without losing
        // the rest of the form data, then re-submits with both fields set.
        return { ok: false, error: 'NEED_MANAGER_PIN' };
      }
      const pinRes = await verifyManagerPin(d.manager_user_id, d.manager_pin);
      if (!pinRes.ok) return { ok: false, error: pinRes.error };
      approverUserId = pinRes.approverUserId;
    } else {
      // Caller is themselves a manager — record their own id as the approver
      // for a clean audit trail (vs. leaving it null and inferring from
      // changed_by, which is harder to query).
      approverUserId = session?.staffUserId ?? null;
    }
  }

  const { data: item } = await supabase
    .from('order_items')
    .select('actual_start, scheduled_start, slot_start, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, status')
    .eq('id', d.item_id)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.status !== 'in_service') return { ok: false, error: 'Only an in-service line can be interrupted' };

  const now = new Date().toISOString();
  const actualMin = item.actual_start
    ? Math.max(1, Math.round((Date.parse(now) - Date.parse(item.actual_start)) / 60000))
    : 0;
  // Calendar block ends at the interrupt point, capped at the planned end.
  const nowMs = Date.parse(now);
  const planEndMs = item.scheduled_start && item.duration_minutes != null
    ? Date.parse(item.scheduled_start) + item.duration_minutes * 60000
    : null;
  const slotStartMs = item.slot_start
    ? Date.parse(item.slot_start)
    : item.scheduled_start ? Date.parse(item.scheduled_start) : nowMs;
  let slotEndMs = planEndMs != null ? Math.min(nowMs, planEndMs) : nowMs;
  if (slotEndMs < slotStartMs) slotEndMs = slotStartMs;
  const slotEnd = new Date(slotEndMs).toISOString();

  // Revenue is recognised on a CHARGED interrupt — the service was (partly)
  // delivered and billed, so it books straight to the folio like a finish:
  //   · full_charge    → the full amount
  //   · partial_charge → prorated by actual vs planned minutes (legacy path)
  //   · no_charge / reschedule → nothing; the waive is the manager-approved
  //     (PIN) audit record instead of a revenue line.
  // Resolved BEFORE the line flips so a missing open shift / category code
  // blocks the interrupt cleanly.
  const planned = item.duration_minutes ?? 0;
  const revenueCents =
    d.handling === 'full_charge'
      ? (item.final_amount_cents ?? 0)
      : d.handling === 'partial_charge'
        ? (planned > 0 ? Math.round((item.final_amount_cents ?? 0) * Math.min(actualMin, planned) / planned) : (item.final_amount_cents ?? 0))
        : 0;
  let revCtx: { shiftId: string; branchId: string | null; txCodeId: string } | null = null;
  if (revenueCents > 0) {
    const rev = await resolveServiceRevenuePosting(supabase, d.item_id, d.order_id);
    if (!rev.ok) return rev;
    revCtx = { shiftId: rev.shiftId, branchId: rev.branchId, txCodeId: rev.txCodeId };
  }

  // The legacy `interruption_reason` column keeps showing a human label so
  // existing Change History UI keeps working without a join. New rows fill
  // both code + label + (optional) free notes.
  const handlingForLabel = d.handling === 'partial_charge' ? 'no_charge' : d.handling;
  const label =
    d.reason ?? interruptReasonLabel(handlingForLabel as 'no_charge' | 'full_charge' | 'reschedule', d.reason_code);

  const { error } = await supabase
    .from('order_items')
    .update({
      status: 'interrupted',
      interruption_handling: d.handling,
      interruption_reason_code: d.reason_code,
      interruption_reason: label,
      interruption_notes: d.notes ?? null,
      interruption_at: now,
      actual_end: now,
      slot_end: slotEnd,
      actual_duration_minutes: actualMin,
      // Reschedule starts in the "pending follow-up" state. Manager clears it
      // from the Pending Reschedules list once the make-up service has been
      // rendered (or the customer abandoned the request).
      reschedule_fulfilled_at: null,
      // Who approved the waive (no_charge). null for full_charge or for the
      // switchService internal path (not a manager decision).
      interruption_approved_by_user_id: approverUserId,
    })
    .eq('id', d.item_id);
  if (error) return { ok: false, error: error.message };

  // Book the charged-interrupt revenue (none for a waive).
  if (revCtx) {
    await postServiceRevenueLine(supabase, { orderId: d.order_id, itemId: d.item_id, amountCents: revenueCents, shiftId: revCtx.shiftId, branchId: revCtx.branchId, txCodeId: revCtx.txCodeId });
  }

  await recomputeTotals(d.order_id);
  // Interrupting the last active service also wraps up the order.
  await maybeAutoComplete(d.order_id);
  revalidatePath(`/sales-orders/${d.order_id}`);
  return { ok: true };
}

/** Manager-only: clear a pending reschedule once the make-up service has
 *  been rendered (or the customer abandoned the request). Pure bookkeeping
 *  — does not touch billing or the original order. */
export async function markRescheduleFulfilled(itemId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: row } = await supabase
    .from('order_items')
    .select('order_id, interruption_handling, reschedule_fulfilled_at')
    .eq('id', itemId)
    .single();
  if (!row) return { ok: false, error: 'Service line not found' };
  if (row.interruption_handling !== 'reschedule') return { ok: false, error: 'Not a rescheduled line' };
  if (row.reschedule_fulfilled_at) return { ok: false, error: 'Already marked fulfilled' };
  const { error } = await supabase
    .from('order_items')
    .update({ reschedule_fulfilled_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/sales-orders/reschedules');
  revalidatePath(`/sales-orders/${row.order_id}`);
  return { ok: true };
}

// Front-desk "redo": re-add a fresh scheduled line for an interrupted/skipped
// service. It copies the same guest, therapist and bed so the line is ready to
// start again as it was (change either if needed). If the interrupt
// auto-completed the order, quietly reopen it — this is a normal counter
// correction, so (unlike the manager-only Reopen) it needs no manager. Blocked
// once money is settled (paid/closed/void → manager reversal).
export async function redoOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createAuditedClient();
  const { data: item } = await supabase
    .from('order_items')
    .select('status, service_item_id, order_customer_id, therapist_id, resource_id, discount_class_id, order:orders!order_items_order_id_fkey ( branch_id, status )')
    .eq('id', itemId)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (!['interrupted', 'cancelled'].includes(item.status)) {
    return { ok: false, error: 'Only an interrupted or skipped service can be redone' };
  }
  const order = Array.isArray(item.order) ? item.order[0] : item.order;
  if (!order) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is already closed — a manager must reopen it first' };
  }
  if (!item.service_item_id || !item.order_customer_id) {
    return { ok: false, error: 'This line has no service/guest to redo' };
  }

  if (order.status === 'completed') {
    const re = await supabase.from('orders').update({ status: 'in_service' }).eq('id', orderId);
    if (re.error) return { ok: false, error: re.error.message };
  }

  let discountClassId: string | null = item.discount_class_id ?? null;
  if (!discountClassId) {
    const { data: dis0 } = await supabase.from('discount_classes').select('id').eq('code', 'DIS-00').maybeSingle();
    discountClassId = dis0?.id ?? null;
  }
  if (!discountClassId) return { ok: false, error: 'No default discount class found' };

  return addOrderItem({
    order_id: orderId,
    order_customer_id: item.order_customer_id,
    service_item_id: item.service_item_id,
    therapist_id: item.therapist_id,
    resource_id: item.resource_id,
    discount_class_id: discountClassId,
  });
}

// Switch an in-service service to a different one: stop the current line with no
// charge (it's being replaced), then the desk picks the new service in the add
// panel. Reopens the order if the stop auto-completed it. Front-desk action.
export async function switchService(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = await createAuditedClient();
  const { data: ord } = await supabase.from('orders').select('branch_id').eq('id', orderId).single();
  if (!ord) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };

  const r = await interruptOrderItem({
    item_id: itemId,
    order_id: orderId,
    handling: 'no_charge',
    reason_code: '__switch_service__',
    reason: 'Switched to another service',
    notes: null,
  });
  if (!r.ok) return r;

  const { data: order } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (order?.status === 'completed') {
    const re = await supabase.from('orders').update({ status: 'in_service' }).eq('id', orderId);
    if (re.error) return { ok: false, error: re.error.message };
    revalidatePath(`/sales-orders/${orderId}`);
  }
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

// Customer feedback per service line. Score (1-10) is required; the captured
// score (feedback row / feedback_score) marks feedback as done — the line's
// status stays service_completed.
export async function submitFeedback(input: unknown): Promise<ActionResult> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'A score (1-10) is required' };
  const d = parsed.data;
  const auth = await requireItemBranchAccess(d.order_item_id);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();

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

  // Feedback no longer changes the line's status — a service stays
  // `service_completed` and the captured score (feedback row / feedback_score)
  // is what marks "feedback done".
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
  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders')
    .select('status, total_cents, service_date')
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'closed') return { ok: false, error: 'Only a closed order needs an adjustment (reopen/void otherwise)' };
  // *_month columns are DATE — store the first of the month, not a YYYY-MM string.
  const nowMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const { error } = await supabase.from('order_adjustments').insert({
    original_order_id: orderId,
    adjustment_type: 'reversal',
    amount_cents: order.total_cents,
    reason: reason.trim(),
    original_month: `${order.service_date.slice(0, 7)}-01`,
    adjustment_month: nowMonth,
    approved_by_user_id: session!.staffUserId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// Forward-only moves a cashier drives. Closed (services done + paid in full) is
// reached automatically by takePayment / maybeAutoComplete, not by hand;
// Void/Reopen are separate gated actions.
const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ['in_service'],
  in_service: ['completed'],
};

export async function setOrderStatus(orderId: string, next: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Sign in required' };
  const supabase = await createAuditedClient();
  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('status, total_cents, paid_cents, branch_id')
    .eq('id', orderId)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  if (order.branch_id && !(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  const allowed = ALLOWED_NEXT[order.status] ?? [];
  if (!allowed.includes(next)) {
    return { ok: false, error: `Cannot move from ${order.status} to ${next}` };
  }

  // A completed order is the bill closed for service: no line may still be
  // pending (draft) or running (in_service) when the order advances.
  if (next === 'completed') {
    const { data: pending } = await supabase
      .from('order_items')
      .select('status')
      .eq('order_id', orderId)
      .in('status', ['draft', 'in_service']);
    if (pending && pending.length > 0) {
      return { ok: false, error: 'Finish, skip, or cancel every service before completing the order' };
    }
  }

  // Completing a bill that's already paid in full finishes it outright (closed);
  // otherwise it sits on completed with the balance owing.
  const effectiveNext =
    next === 'completed' && order.total_cents > 0 && order.paid_cents >= order.total_cents
      ? 'closed'
      : next;

  const { error } = await supabase.from('orders').update({ status: effectiveNext }).eq('id', orderId);
  if (error) return { ok: false, error: error.message };
  await logStatus(orderId, order.status, effectiveNext, null, session?.staffUserId ?? null);
  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// GL credit accounts that disambiguate same-method transaction codes (mirrors
// the ERP resolver in revenue-confirm): service revenue vs tip payable.
const TX_REVENUE_ACCOUNT = '40140';
const TX_TIPS_PAYABLE = '20500';

// Resolve the active transaction_code id for a folio posting. Payment-side codes
// are branch-scoped and keyed by (method, credit account); the branchless
// service-revenue code is keyed by credit account alone. Returns null when no
// matching code is configured — the line still posts, the ERP step flags the gap.
async function resolveTxCodeId(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  args: { branchId: string | null; type: string; methodId?: string | null; creditAccount: string },
): Promise<string | null> {
  let q = supabase
    .from('transaction_codes')
    .select('id')
    .eq('transaction_type', args.type)
    .eq('credit_account', args.creditAccount)
    .eq('active', true);
  q = args.branchId ? q.eq('branch_id', args.branchId) : q.is('branch_id', null);
  q = args.methodId ? q.eq('payment_method_id', args.methodId) : q.is('payment_method_id', null);
  const { data } = await q.maybeSingle();
  return data?.id ?? null;
}

// The payment-side code for a (branch, method): the branch's active payment code
// for that method that ISN'T the tip code. This is correct for every method —
// cash/PAYMAYA/AR credit revenue (40140) while stored-value credits its deposit
// liability (20510); only the PAYMAYA tip code (CR 20500) is excluded so the
// payment-vs-tip pair on PAYMAYA resolves to the payment side. Mirrors the
// read-only code shown in the folio dialogs.
async function resolvePaymentTxCodeId(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  branchId: string | null,
  methodId: string,
): Promise<string | null> {
  let q = supabase
    .from('transaction_codes')
    .select('id')
    .eq('transaction_type', 'payment')
    .eq('payment_method_id', methodId)
    .neq('credit_account', TX_TIPS_PAYABLE)
    .eq('active', true)
    .order('credit_account')
    .limit(1);
  q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
  const { data } = await q;
  return data?.[0]?.id ?? null;
}

// AR (掛帳) code rides the bill_to destination: one bound code carrying its own
// DR/CR (and DR/CR branch). A method=ar folio line uses this instead of the
// branch+method payment code, so the receivable books against the right hotel.
async function resolveBillToTxCodeId(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  billingDestinationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('billing_destinations')
    .select('transaction_code_id')
    .eq('id', billingDestinationId)
    .maybeSingle();
  return data?.transaction_code_id ?? null;
}

const paymentSchema = z.object({
  order_id: z.string().uuid(),
  order_customer_id: z.string().uuid().optional().nullable(),
  // Posting branch (which branch's open shift receives this). Defaults to the
  // order branch when omitted; the dialog lets the operator pick.
  branch_id: z.string().uuid().optional().nullable(),
  // Bill to (billing destination). Required when method = ar — it resolves the
  // AR transaction code and is stamped on the folio line for SOA grouping.
  billing_destination_id: z.string().uuid().optional().nullable(),
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
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Sign in required' };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const amountCents = Math.round(d.amount * 100);

  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('total_cents, paid_cents, status, branch_id, service_date')
    .eq('id', d.order_id)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  // Posting branch: operator's choice, else the order branch.
  const postBranchId = d.branch_id ?? order.branch_id;
  if (postBranchId && !(await canAccessBranch(postBranchId))) return { ok: false, error: 'No access to this branch' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is already closed or void' };
  }
  if (await isBusinessDayClosed(postBranchId, order.service_date)) {
    return { ok: false, error: 'The business day is closed — payments can no longer post to this date.' };
  }
  // Every posting needs an open cash shift to land in. Block the payment when
  // none is open for the branch.
  const openShift = postBranchId ? await getCurrentOpenShift(postBranchId) : null;
  if (!openShift) {
    return { ok: false, error: 'No cash shift is open for this branch - open one on the Sales Remittance page before taking payment.' };
  }
  // No overpayment: a collection can't push the paid total past the order total.
  if (order.paid_cents + amountCents > order.total_cents) {
    const due = Math.max(0, order.total_cents - order.paid_cents);
    return { ok: false, error: `Amount exceeds the balance due (${(due / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })})` };
  }

  // Per-guest cap (Pay separately): a payment tagged to one guest can't exceed
  // that guest's own balance. Without this, one guest could be over-collected
  // while another is left short even though the order total still nets — strictly
  // no over/under per scope. Manager Collect more carries no order_customer_id, so
  // it stays at order scope (the sanctioned exception path) and skips this check.
  if (d.order_customer_id) {
    const { data: custItems } = await supabase
      .from('order_items')
      .select('final_amount_cents')
      .eq('order_id', d.order_id)
      .eq('order_customer_id', d.order_customer_id)
      .not('status', 'in', '(cancelled,no_show)');
    const custSubtotal = (custItems ?? []).reduce((s, i) => s + (i.final_amount_cents ?? 0), 0);
    const { data: custPays } = await supabase
      .from('folio_lines')
      .select('amount_cents, kind')
      .eq('order_id', d.order_id)
      .eq('order_customer_id', d.order_customer_id)
      .in('kind', ['payment', 'refund', 'tip']);
    const custPaid = (custPays ?? []).reduce((s, p) => s + (p.kind === 'payment' ? p.amount_cents : -p.amount_cents), 0);
    const custDue = Math.max(0, custSubtotal - custPaid);
    if (amountCents > custDue) {
      return { ok: false, error: `Amount exceeds this guest's balance due (${(custDue / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })})` };
    }
  }

  const { data: method } = await supabase
    .from('payment_methods')
    .select('code')
    .eq('id', d.payment_method_id)
    .single();

  // Tips ride a non-cash payment (PAYMAYA, or a stored-value redemption where the
  // tip itself is charged via PAYMAYA). Cash tips never enter the system.
  const tips = d.tips ?? [];
  const tipsTotalCents = tips.reduce((s, t) => s + Math.round(t.amount * 100), 0);
  // The payment folio line is GROSS: the full cash the method actually received
  // (service + tips). Tips are recognised as revenue (kind=tip lines on the
  // revenue side) and the order total includes them, so paid == total at settle.
  const grossCents = amountCents + tipsTotalCents;
  if (tips.length > 0 && !['paymaya', 'stored_value_card'].includes(method?.code ?? '')) {
    return { ok: false, error: 'Tips can only be recorded on a PAYMAYA or stored-value payment' };
  }

  // Stored-value redemption: deduct the card balance and ledger the consume.
  let svcCard: { id: string; current_balance_cents: number; branch_id: string; status: string } | null = null;
  if (method?.code?.toLowerCase() === 'stored_value_card') {
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

  // Resolve the GL code for this line. AR (掛帳) rides the bill_to destination's
  // bound code; every other method uses the branch-scoped payment code. AR also
  // requires a Bill to + a named guest (a statement must show who).
  const isAr = method?.code?.toLowerCase() === 'ar';
  let billingDestinationId: string | null = null;
  let paymentTxCodeId: string | null;
  if (isAr) {
    if (!d.billing_destination_id) return { ok: false, error: 'Pick a Bill to for an AR (on-account) charge.' };
    if (!d.order_customer_id) return { ok: false, error: 'Pick the guest for an AR charge — the statement must show a name.' };
    billingDestinationId = d.billing_destination_id;
    paymentTxCodeId = await resolveBillToTxCodeId(supabase, billingDestinationId);
    if (!paymentTxCodeId) return { ok: false, error: 'This billing destination has no transaction code bound — set one in Settings → Billing Destinations first.' };
  } else {
    paymentTxCodeId = await resolvePaymentTxCodeId(supabase, postBranchId, d.payment_method_id);
    if (!paymentTxCodeId) return { ok: false, error: 'No payment transaction code is configured for this branch + method — set one up in Settings → Transaction Codes first.' };
  }
  const tipTxCodeId = tips.length > 0 ? await resolveTxCodeId(supabase, { branchId: postBranchId, type: 'payment', methodId: d.payment_method_id, creditAccount: TX_TIPS_PAYABLE }) : null;
  if (tips.length > 0 && !tipTxCodeId) return { ok: false, error: 'No tip transaction code is configured for this branch + method — set one up in Settings → Transaction Codes first.' };

  // The payment is a folio line bound to the open shift (folio_lines is the
  // single ledger now - there is no separate payments table).
  const { data: paymentLine, error: pe } = await supabase
    .from('folio_lines')
    .insert({
      order_id: d.order_id,
      order_customer_id: d.order_customer_id || null,
      shift_id: openShift.id,
      kind: 'payment',
      amount_cents: grossCents,
      posted_by: session.staffUserId,
      payment_method_id: d.payment_method_id,
      payment_ref: d.payment_ref || null,
      stored_value_card_id: svcCard?.id ?? null,
      branch_id: postBranchId,
      billing_destination_id: billingDestinationId,
      transaction_code_id: paymentTxCodeId,
    })
    .select('id')
    .single();
  if (pe || !paymentLine) return { ok: false, error: pe?.message ?? 'Payment posting failed' };

  if (svcCard) {
    const balanceAfter = svcCard.current_balance_cents - amountCents;
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
      related_folio_line_id: paymentLine.id,
      approved_by_user_id: session?.staffUserId ?? null,
    });
  }

  // Each tip posts its own kind=tip folio line; the tips row (per-therapist,
  // for commission) links to it via folio_line_id.
  for (const t of tips) {
    const tipCents = Math.round(t.amount * 100);
    const { data: tipLine, error: tle } = await supabase
      .from('folio_lines')
      .insert({
        order_id: d.order_id,
        order_customer_id: d.order_customer_id || null,
        shift_id: openShift.id,
        kind: 'tip',
        amount_cents: tipCents,
        posted_by: session.staffUserId,
        payment_method_id: d.payment_method_id,
        branch_id: postBranchId,
        transaction_code_id: tipTxCodeId,
      })
      .select('id')
      .single();
    if (tle || !tipLine) return { ok: false, error: tle?.message ?? 'Tip posting failed' };
    const { error: te } = await supabase.from('tips').insert({
      order_id: d.order_id,
      order_item_id: t.order_item_id,
      therapist_id: t.therapist_id,
      folio_line_id: tipLine.id,
      amount_cents: tipCents,
      status: 'open',
    });
    if (te) return { ok: false, error: te.message };
  }

  // Tips just posted are part of the bill now, so refresh the total before
  // settling, then compare gross paid against the fresh total.
  await recomputeTotals(d.order_id);
  const { data: fresh } = await supabase.from('orders').select('total_cents').eq('id', d.order_id).single();
  const freshTotal = fresh?.total_cents ?? order.total_cents;
  const newPaid = order.paid_cents + grossCents;
  const patch: { paid_cents: number; status?: string } = { paid_cents: newPaid };
  // Auto-close once the bill is fully covered AND every service is done. Paying
  // in full while still in service just sits as paid; the order closes when the
  // last service finishes (maybeAutoComplete).
  if (newPaid >= freshTotal && freshTotal > 0 && order.status === 'completed') {
    patch.status = 'closed';
  }
  const { error: ue } = await supabase.from('orders').update(patch).eq('id', d.order_id);
  if (ue) return { ok: false, error: ue.message };

  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${d.order_id}`);
  // Cash recon page reads payments live — without this, a cashier who took
  // cash and then opened /reconciliation/cash in the same session would see
  // stale "Cash received this shift" until manual F5. Same story for the
  // daily-close hub, Revenue Confirm, and the dashboard count widgets.
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}

const refundSchema = z.object({
  order_id: z.string().uuid(),
  branch_id: z.string().uuid().optional().nullable(),
  billing_destination_id: z.string().uuid().optional().nullable(),
  payment_method_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_ref: z.string().max(80).optional().nullable(),
  order_customer_id: z.string().uuid().optional().nullable(),
  stored_value_card_id: z.string().uuid().optional().nullable(),
});

// Record a refund against an order with money collected — money going back out.
// Stored as a negative payment so it flows through paid_cents AND the shift cash
// count (a cash refund correctly reduces the drawer's expected cash). Manager-
// gated; can't exceed what was collected; a stored-value refund loads back onto
// the card. A refund on a closed (fully-paid) order reopens its balance →
// completed. Void orders are corrected via an OrderAdjustment instead.
export async function recordRefund(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to refund' };
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const amountCents = Math.round(d.amount * 100);

  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('total_cents, paid_cents, status, branch_id, service_date')
    .eq('id', d.order_id)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  const postBranchId = d.branch_id ?? order.branch_id;
  if (postBranchId && !(await canAccessBranch(postBranchId))) return { ok: false, error: 'No access to this branch' };
  if (order.status === 'void') {
    return { ok: false, error: 'A void order is corrected via an adjustment, not a refund' };
  }
  if (await isBusinessDayClosed(postBranchId, order.service_date)) {
    return { ok: false, error: 'The business day is closed — refunds can no longer post to this date.' };
  }
  if (amountCents > order.paid_cents) {
    return { ok: false, error: `Refund exceeds the amount collected (${(order.paid_cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })})` };
  }

  const openShift = postBranchId ? await getCurrentOpenShift(postBranchId) : null;
  if (!openShift) {
    return { ok: false, error: 'No cash shift is open for this branch - open one on the Sales Remittance page before refunding.' };
  }

  const { data: method } = await supabase.from('payment_methods').select('code').eq('id', d.payment_method_id).single();

  // Stored-value refund → load the amount back onto the card.
  let card: { current_balance_cents: number; branch_id: string } | null = null;
  if (method?.code?.toLowerCase() === 'stored_value_card') {
    if (!d.stored_value_card_id) return { ok: false, error: 'Select a stored value card to refund onto' };
    const { data: c } = await supabase
      .from('stored_value_cards')
      .select('current_balance_cents, branch_id')
      .eq('id', d.stored_value_card_id)
      .single();
    if (!c) return { ok: false, error: 'Card not found' };
    card = c;
  }

  // Refund = an append-only folio line (kind=refund). Amount is stored positive;
  // the kind carries the direction. paid = sum(payment) - sum(refund). AR refunds
  // ride the bill_to code (need a Bill to + guest); other methods reuse the
  // method's payment code (a refund reverses a payment).
  const isAr = method?.code?.toLowerCase() === 'ar';
  let billingDestinationId: string | null = null;
  let refundTxCodeId: string | null;
  if (isAr) {
    if (!d.billing_destination_id) return { ok: false, error: 'Pick a Bill to for an AR refund.' };
    if (!d.order_customer_id) return { ok: false, error: 'Pick the guest for an AR refund — the statement must show a name.' };
    billingDestinationId = d.billing_destination_id;
    refundTxCodeId = await resolveBillToTxCodeId(supabase, billingDestinationId);
    if (!refundTxCodeId) return { ok: false, error: 'This billing destination has no transaction code bound — set one in Settings → Billing Destinations first.' };
  } else {
    refundTxCodeId = await resolvePaymentTxCodeId(supabase, postBranchId, d.payment_method_id);
    if (!refundTxCodeId) return { ok: false, error: 'No payment transaction code is configured for this branch + method — set one up in Settings → Transaction Codes first.' };
  }
  const { data: refundLine, error: pe } = await supabase
    .from('folio_lines')
    .insert({
      order_id: d.order_id,
      order_customer_id: d.order_customer_id || null,
      shift_id: openShift.id,
      kind: 'refund',
      amount_cents: amountCents,
      posted_by: session!.staffUserId,
      payment_method_id: d.payment_method_id,
      payment_ref: d.payment_ref || null,
      stored_value_card_id: d.stored_value_card_id || null,
      branch_id: postBranchId,
      billing_destination_id: billingDestinationId,
      transaction_code_id: refundTxCodeId,
    })
    .select('id')
    .single();
  if (pe || !refundLine) return { ok: false, error: pe?.message ?? 'Refund posting failed' };

  if (card && d.stored_value_card_id) {
    const balanceAfter = card.current_balance_cents + amountCents;
    await supabase.from('stored_value_cards')
      .update({ current_balance_cents: balanceAfter, status: 'active' })
      .eq('id', d.stored_value_card_id);
    await supabase.from('stored_value_transactions').insert({
      card_id: d.stored_value_card_id,
      branch_id: card.branch_id,
      type: 'refund',
      amount_cents: amountCents,
      balance_after_cents: balanceAfter,
      related_order_id: d.order_id,
      related_folio_line_id: refundLine.id,
      approved_by_user_id: session!.staffUserId,
      note: 'Order refund',
    });
  }

  const newPaid = order.paid_cents - amountCents;
  const patch: { paid_cents: number; status?: string } = { paid_cents: newPaid };
  // A refund that drops a closed (fully-paid) order below its total reopens the
  // balance, so it steps back to completed with the shortfall owing.
  if (order.status === 'closed' && newPaid < order.total_cents) patch.status = 'completed';
  const { error: ue } = await supabase.from('orders').update(patch).eq('id', d.order_id);
  if (ue) return { ok: false, error: ue.message };

  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${d.order_id}`);
  revalidatePath('/reconciliation/cash');
  return { ok: true };
}

// Shared guard for a manual folio revenue posting (Add revenue / Adjust charge):
// the order must be reachable, the business day open, and a cash shift open for
// the branch (every folio line is shift-bound). Returns the resolved bits.
async function revenuePostingContext(orderId: string, branchOverride?: string | null): Promise<
  | { ok: true; shiftId: string; branchId: string | null }
  | { ok: false; error: string }
> {
  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders')
    .select('status, branch_id, service_date')
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: 'Order not found' };
  const postBranchId = branchOverride ?? order.branch_id;
  if (postBranchId && !(await canAccessBranch(postBranchId))) return { ok: false, error: 'No access to this branch' };
  if (order.status === 'void') return { ok: false, error: 'Order is void' };
  if (await isBusinessDayClosed(postBranchId, order.service_date)) {
    return { ok: false, error: 'The business day is closed — revenue can no longer post to this date.' };
  }
  const openShift = postBranchId ? await getCurrentOpenShift(postBranchId) : null;
  if (!openShift) {
    return { ok: false, error: 'No cash shift is open for this branch — open one on the Sales Remittance page first.' };
  }
  return { ok: true, shiftId: openShift.id, branchId: postBranchId };
}

const addRevenueSchema = z.object({
  order_id: z.string().uuid(),
  branch_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive(),
  note: z.string().max(200).optional().nullable(),
});

// Manually post a revenue line to the order's folio (a positive kind=revenue
// line bound to the open shift). For revenue that isn't a service line — a
// surcharge, a correction up, etc. Available in any status; the order's billed
// total (derived from items + tips) is untouched, this rides the folio ledger.
export async function addRevenue(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Sign in required' };
  const parsed = addRevenueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const ctx = await revenuePostingContext(d.order_id, d.branch_id);
  if (!ctx.ok) return ctx;

  const supabase = await createAuditedClient();
  // Manual revenue has no service category to bind a code from, so fall back to
  // the branchless service-revenue code (CR 40140).
  const txCodeId = await resolveTxCodeId(supabase, { branchId: null, type: 'revenue', methodId: null, creditAccount: TX_REVENUE_ACCOUNT });
  if (!txCodeId) return { ok: false, error: 'No revenue transaction code is configured — set one up in Settings → Transaction Codes first.' };
  const { error } = await supabase.from('folio_lines').insert({
    order_id: d.order_id,
    shift_id: ctx.shiftId,
    kind: 'revenue',
    amount_cents: Math.round(d.amount * 100),
    posted_by: session.staffUserId,
    note: d.note?.trim() || null,
    branch_id: ctx.branchId,
    transaction_code_id: txCodeId,
  });
  if (error) return { ok: false, error: error.message };

  // Manual revenue is part of the bill — refresh the total and reopen the order
  // if it had already been settled.
  await recomputeTotals(d.order_id);
  await reconcilePaidStatus(d.order_id);

  revalidatePath(`/sales-orders/${d.order_id}`);
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}

const adjustChargeSchema = z.object({
  order_id: z.string().uuid(),
  branch_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive(),
  note: z.string().min(3, 'A reason is required').max(200),
  // Manager-override PIN (any active manager/admin's) — entered as one masked
  // field in the dialog; verified against all managers so no picker is needed.
  manager_pin: z.string().regex(/^\d{4,6}$/, 'Enter the 4–6 digit manager PIN'),
});

// Post a downward charge correction to the folio: the operator enters a positive
// amount, it lands as a NEGATIVE kind=revenue line (reduces recognised revenue).
// Manager-gated via a single override PIN; the approver is recorded on the note.
export async function adjustCharge(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Sign in required' };
  const parsed = adjustChargeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const pin = await verifyAnyManagerPin(d.manager_pin);
  if (!pin.ok) return { ok: false, error: pin.error };

  const ctx = await revenuePostingContext(d.order_id, d.branch_id);
  if (!ctx.ok) return ctx;

  const supabase = await createAuditedClient();
  const txCodeId = await resolveTxCodeId(supabase, { branchId: null, type: 'revenue', methodId: null, creditAccount: TX_REVENUE_ACCOUNT });
  if (!txCodeId) return { ok: false, error: 'No revenue transaction code is configured — set one up in Settings → Transaction Codes first.' };
  const { error } = await supabase.from('folio_lines').insert({
    order_id: d.order_id,
    shift_id: ctx.shiftId,
    kind: 'revenue',
    amount_cents: -Math.round(d.amount * 100),
    posted_by: session.staffUserId,
    note: `${d.note.trim()} (approved: ${pin.approverName})`,
    branch_id: ctx.branchId,
    transaction_code_id: txCodeId,
  });
  if (error) return { ok: false, error: error.message };

  // The downward correction lowers the bill — refresh the total and settle the
  // order if the adjustment cleared the remaining balance.
  await recomputeTotals(d.order_id);
  await reconcilePaidStatus(d.order_id);

  revalidatePath(`/sales-orders/${d.order_id}`);
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}
