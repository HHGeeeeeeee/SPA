'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient, createAuditedClient } from '@/lib/supabase/server';
import { nextOrderNo } from '@/lib/order-no';
import { currentSession, isManager } from '@/lib/auth';
import { isBusinessDayClosed } from '@/app/(dashboard)/reconciliation/end-of-day/actions';
import { canAccessBranch } from '@/lib/branch-access';
import { canPerformGroup, matchesGender } from '@/lib/therapist-availability';
import { assertBedMatchesServiceItem } from '@/lib/resource-compatibility';
import {
  INTERRUPT_REASON_CODES_BY_HANDLING,
  interruptReasonLabel,
} from '@/lib/interrupt-taxonomy';
import { verifyManagerPin, listPinCapableManagers } from '@/lib/manager-pin';

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

// Normalize a possibly-array Supabase to-one join down to the method code.
function methodCode(method: unknown): string | null {
  const m = Array.isArray(method) ? method[0] : method;
  return (m as { code?: string } | null)?.code ?? null;
}

// Refund a stored-value redemption back onto its card before its payment row is
// deleted: clear the consume row's link to the payment (that FK is NO ACTION, so
// it would otherwise block the delete), restore the balance, and write a reversal
// ledger row. No-op for any non-stored-value payment.
async function refundStoredValuePayment(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  payment: { id: string; amount_cents: number; stored_value_card_id: string | null; code: string | null },
  orderId: string,
  staffId: string | null,
  note: string,
): Promise<void> {
  if (payment.code !== 'stored_value_card' || !payment.stored_value_card_id) return;
  await supabase.from('stored_value_transactions').update({ related_payment_id: null }).eq('related_payment_id', payment.id);
  const { data: card } = await supabase
    .from('stored_value_cards')
    .select('current_balance_cents, branch_id')
    .eq('id', payment.stored_value_card_id)
    .single();
  if (!card) return;
  const balanceAfter = card.current_balance_cents + payment.amount_cents;
  await supabase.from('stored_value_cards')
    .update({ current_balance_cents: balanceAfter, status: 'active' })
    .eq('id', payment.stored_value_card_id);
  await supabase.from('stored_value_transactions').insert({
    card_id: payment.stored_value_card_id,
    branch_id: card.branch_id,
    type: 'refund',
    amount_cents: payment.amount_cents,
    balance_after_cents: balanceAfter,
    related_order_id: orderId,
    approved_by_user_id: staffId,
    note,
  });
}

export async function voidOrder(id: string, reason: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to void' };
  if (!reason || reason.trim().length < 3) return { ok: false, error: 'A reason is required to void' };
  const supabase = await createAuditedClient();
  const { data: order } = await supabase.from('orders').select('status').eq('id', id).single();
  if (!order) return { ok: false, error: 'Order not found' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'A closed or already-void order cannot be voided' };
  }

  // Voiding cancels the order's payments + tips. A tip already on a settlement
  // payout can't be unwound here — reverse that settlement first.
  const { data: settledTips } = await supabase
    .from('tips')
    .select('id')
    .eq('order_id', id)
    .not('settlement_id', 'is', null)
    .limit(1);
  if (settledTips && settledTips.length > 0) {
    return { ok: false, error: 'A tip on this order is already settled — reverse the settlement before voiding.' };
  }

  // Stored-value redemptions are refunded back onto their cards before the
  // payments are removed (see refundStoredValuePayment).
  const { data: pays } = await supabase
    .from('payments')
    .select('id, amount_cents, stored_value_card_id, method:payment_methods ( code )')
    .eq('order_id', id);
  for (const p of pays ?? []) {
    await refundStoredValuePayment(
      supabase,
      { id: p.id, amount_cents: p.amount_cents, stored_value_card_id: p.stored_value_card_id, code: methodCode(p.method) },
      id,
      session!.staffUserId,
      'Order voided',
    );
  }

  await supabase.from('tips').delete().eq('order_id', id);
  const { error: pe } = await supabase.from('payments').delete().eq('order_id', id);
  if (pe) return { ok: false, error: pe.message };

  const { error } = await supabase.from('orders').update({ status: 'void', paid_cents: 0 }).eq('id', id);
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
  if (!['draft', 'open', 'in_service'].includes(order.status)) {
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

// ---------------------------------------------------------------------------
// Line-item editor
// ---------------------------------------------------------------------------

async function recomputeTotals(orderId: string) {
  const supabase = await createAuditedClient();
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
  if (items.some((i) => ['scheduled', 'in_service'].includes(i.status))) return; // work still pending
  const { data: ord } = await supabase.from('orders').select('status').eq('id', orderId).single();
  if (ord && ['open', 'in_service'].includes(ord.status)) {
    await supabase.from('orders').update({ status: 'completed' }).eq('id', orderId);
    await logStatus(orderId, ord.status, 'completed', 'All services finished or skipped', null);
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
  if (!['draft', 'open', 'in_service'].includes(ord.status)) return { ok: false, error: 'This order can no longer be edited' };
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
  if ((custItems ?? []).some((i) => !['scheduled', 'cancelled'].includes(i.status))) {
    return { ok: false, error: 'This guest has a started or finished service and can\'t be removed.' };
  }
  const { data: custPays } = await supabase.from('payments').select('id').eq('order_customer_id', customerId).limit(1);
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
});

// Rename / re-phone an existing guest (e.g. fill in a converted booking's
// "Guest 2" placeholder once they're at the desk).
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

export async function addOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();

  const { data: ord } = await supabase.from('orders').select('status, branch_id').eq('id', d.order_id).single();
  if (!ord) return { ok: false, error: 'Order not found' };
  if (!(await canAccessBranch(ord.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['draft', 'open', 'in_service'].includes(ord.status)) return { ok: false, error: 'This order can no longer be edited' };

  // Server-side backstop for the UI's station-by-type filter. The picker
  // already hides incompatible stations, but a stale form, a future API
  // client, or a manual id paste would slip through without this check.
  if (d.resource_id) {
    const compat = await assertBedMatchesServiceItem(d.resource_id, d.service_item_id);
    if (!compat.ok) return { ok: false, error: compat.error };
  }

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
  const supabase = await createAuditedClient();

  const { data: existing } = await supabase.from('order_items').select('status').eq('id', d.id).single();
  if (!existing) return { ok: false, error: 'Service line not found' };
  if (existing.status !== 'scheduled') return { ok: false, error: 'Only a not-yet-started line can be edited' };

  // Same backstop as addOrderItem — UI filter is convenience, not security.
  if (d.resource_id) {
    const compat = await assertBedMatchesServiceItem(d.resource_id, d.service_item_id);
    if (!compat.ok) return { ok: false, error: compat.error };
  }

  const res = await resolveLinePricing(supabase, d);
  if ('error' in res) return { ok: false, error: res.error };

  const { error } = await supabase.from('order_items').update(res.patch).eq('id', d.id);
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
  if (item.status !== 'scheduled') {
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
    .select('therapist_id, resource_id, service_item_id, order_customer_id, service:service_items ( commission_applicable, required_resource_type, service_group )')
    .eq('id', itemId)
    .single();

  // Can't start a hands-on service with nobody to do it, or a service that needs
  // a station/bed without one assigned. (Rest-room style lines need neither.)
  const svc = Array.isArray(item?.service) ? item?.service[0] : item?.service;
  if (svc?.commission_applicable && !item?.therapist_id) {
    return { ok: false, error: 'Assign a therapist before starting this service' };
  }
  if (svc?.required_resource_type && !item?.resource_id) {
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
    const [{ data: emp }, { data: caps }, { data: ord0 }] = await Promise.all([
      supabase.from('employees').select('gender').eq('id', item.therapist_id).single(),
      supabase.from('employee_service_groups').select('service_group').eq('employee_id', item.therapist_id),
      supabase.from('orders').select('reservation:reservations ( gender_preference )').eq('id', orderId).single(),
    ]);
    if (!canPerformGroup((caps ?? []).map((c) => c.service_group), group)) {
      return { ok: false, error: 'This therapist is not trained for this service' };
    }
    const resv = Array.isArray(ord0?.reservation) ? ord0?.reservation[0] : ord0?.reservation;
    if (!matchesGender(emp?.gender, resv?.gender_preference ?? null)) {
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
    if (it.status !== 'scheduled' || busyCustomers.has(it.order_customer_id) || seen.has(it.order_customer_id)) continue;
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

export async function finishOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const auth = await requireOrderBranchAccess(orderId);
  if (!auth.ok) return auth;
  const supabase = await createAuditedClient();
  const now = new Date().toISOString();
  const { data: item } = await supabase
    .from('order_items')
    .select('actual_start, status')
    .eq('id', itemId)
    .single();
  if (!item) return { ok: false, error: 'Service line not found' };
  if (item.status !== 'in_service') return { ok: false, error: 'Only an in-service line can be finished' };
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
  revalidatePath('/shift-schedule');
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
  if (item.status !== 'scheduled') {
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
      actual_duration_minutes: actualMin,
      discount_amount_cents: discount,
      final_amount_cents: final,
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
  if (['paid', 'closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is already paid/closed — a manager must reopen it first' };
  }
  if (!item.service_item_id || !item.order_customer_id) {
    return { ok: false, error: 'This line has no service/guest to redo' };
  }

  if (order.status === 'completed') {
    const re = await supabase.from('orders').update({ status: 'open' }).eq('id', orderId);
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
    const re = await supabase.from('orders').update({ status: 'open' }).eq('id', orderId);
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

// Customer feedback per service line. Score (1-10) is required; submitting marks
// the item feedback_done. Spec: feedback submission is the service-complete check.
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

  // Opening means the order is ready to run: it must have services, every guest
  // must have one, and each service needs its therapist (hands-on) + bed.
  if (next === 'open') {
    const [{ data: customers }, { data: items }] = await Promise.all([
      supabase.from('order_customers').select('id, customer_name').eq('order_id', orderId),
      supabase
        .from('order_items')
        .select('therapist_id, resource_id, order_customer_id, service:service_items ( name, commission_applicable, required_resource_type )')
        .eq('order_id', orderId)
        .neq('status', 'cancelled'),
    ]);
    if (!items || items.length === 0) return { ok: false, error: 'Add at least one service before opening the order' };
    const withService = new Set((items ?? []).map((i) => i.order_customer_id));
    const emptyGuest = (customers ?? []).find((c) => !withService.has(c.id));
    if (emptyGuest) return { ok: false, error: `${emptyGuest.customer_name || 'A guest'} has no service — add one or remove the guest` };
    for (const it of items) {
      const svc = Array.isArray(it.service) ? it.service[0] : it.service;
      if (svc?.commission_applicable && !it.therapist_id) return { ok: false, error: `Assign a therapist to "${svc?.name ?? 'every service'}" before opening` };
      if (svc?.required_resource_type && !it.resource_id) return { ok: false, error: `Assign a station/bed to "${svc?.name ?? 'every service'}" before opening` };
    }
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
  if (!(await currentSession())) return { ok: false, error: 'Sign in required' };
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
  if (order.branch_id && !(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is already closed or void' };
  }
  if (await isBusinessDayClosed(order.branch_id, order.service_date)) {
    return { ok: false, error: 'The business day is closed — payments can no longer post to this date.' };
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
      .neq('status', 'cancelled');
    const custSubtotal = (custItems ?? []).reduce((s, i) => s + i.final_amount_cents, 0);
    const { data: custPays } = await supabase
      .from('payments')
      .select('amount_cents')
      .eq('order_id', d.order_id)
      .eq('order_customer_id', d.order_customer_id);
    const custPaid = (custPays ?? []).reduce((s, p) => s + p.amount_cents, 0);
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
  // Cash recon page reads payments live — without this, a cashier who took
  // cash and then opened /reconciliation/cash in the same session would see
  // stale "Cash received this shift" until manual F5. Same story for the
  // daily-close hub, Revenue Confirm, and the dashboard count widgets.
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}

// Reverse a recorded payment: drop it (and its open tips), refund a stored-value
// redemption back onto its card, refund the order's paid total, and step a
// fully-paid order back to completed if it no longer is.
export async function voidPayment(paymentId: string, orderId: string): Promise<ActionResult> {
  // Voiding a payment row deletes it outright — that's a reversal, not a routine
  // cashier action, so it's manager-only. Routine refunds use `recordRefund`.
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to void a payment' };
  const supabase = await createAuditedClient();
  const { data: order, error: oe } = await supabase
    .from('orders')
    .select('status, total_cents, branch_id')
    .eq('id', orderId)
    .single();
  if (oe || !order) return { ok: false, error: 'Order not found' };
  if (order.branch_id && !(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'Order is locked — reopen is not possible' };
  }
  // A fully-paid order is settled — its payments can't be deleted (by anyone).
  // Adjust the money with the header Collect / Refund actions instead.
  if (order.status === 'paid') {
    return { ok: false, error: 'Order is fully paid — use Collect / Refund to adjust, not delete.' };
  }

  const { data: settled } = await supabase
    .from('tips')
    .select('id')
    .eq('payment_id', paymentId)
    .not('settlement_id', 'is', null);
  if (settled && settled.length > 0) {
    return { ok: false, error: 'A tip on this payment is already settled; cannot void it' };
  }

  // Stored-value redemption → refund the card before its payment row is removed.
  const { data: pay } = await supabase
    .from('payments')
    .select('amount_cents, stored_value_card_id, method:payment_methods ( code )')
    .eq('id', paymentId)
    .single();
  if (pay) {
    const session = await currentSession();
    await refundStoredValuePayment(
      supabase,
      { id: paymentId, amount_cents: pay.amount_cents, stored_value_card_id: pay.stored_value_card_id, code: methodCode(pay.method) },
      orderId,
      session?.staffUserId ?? null,
      'Payment reversed',
    );
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
  // Mirror the recordPayment revalidation — a voided cash payment changes
  // the drawer's expected total too.
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}

const refundSchema = z.object({
  order_id: z.string().uuid(),
  payment_method_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_ref: z.string().max(80).optional().nullable(),
  order_customer_id: z.string().uuid().optional().nullable(),
  stored_value_card_id: z.string().uuid().optional().nullable(),
});

// Record a refund against a completed/paid order — money going back out. Stored
// as a negative payment so it flows through paid_cents AND the shift cash count
// (a cash refund correctly reduces the drawer's expected cash). Manager-gated;
// can't exceed what was collected; a stored-value refund loads back onto the
// card. Closed orders are corrected via an OrderAdjustment instead.
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
  if (['closed', 'void'].includes(order.status)) {
    return { ok: false, error: 'A closed or void order is corrected via an adjustment, not a refund' };
  }
  if (await isBusinessDayClosed(order.branch_id, order.service_date)) {
    return { ok: false, error: 'The business day is closed — refunds can no longer post to this date.' };
  }
  if (amountCents > order.paid_cents) {
    return { ok: false, error: `Refund exceeds the amount collected (${(order.paid_cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })})` };
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

  const { data: payment, error: pe } = await supabase
    .from('payments')
    .insert({
      order_id: d.order_id,
      order_customer_id: d.order_customer_id || null,
      payment_method_id: d.payment_method_id,
      amount_cents: -amountCents,
      payment_ref: d.payment_ref || null,
      stored_value_card_id: d.stored_value_card_id || null,
      paid_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (pe || !payment) return { ok: false, error: pe?.message ?? 'Refund insert failed' };

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
      related_payment_id: payment.id,
      approved_by_user_id: session!.staffUserId,
      note: 'Order refund',
    });
  }

  const newPaid = order.paid_cents - amountCents;
  const patch: { paid_cents: number; status?: string } = { paid_cents: newPaid };
  if (order.status === 'paid' && newPaid < order.total_cents) patch.status = 'completed';
  const { error: ue } = await supabase.from('orders').update(patch).eq('id', d.order_id);
  if (ue) return { ok: false, error: ue.message };

  revalidatePath('/sales-orders');
  revalidatePath(`/sales-orders/${d.order_id}`);
  revalidatePath('/reconciliation/cash');
  return { ok: true };
}
