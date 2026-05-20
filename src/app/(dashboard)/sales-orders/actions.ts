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

  const order_no = await nextOrderNo(branch.code, d.service_date);

  const { data, error } = await supabase
    .from('orders')
    .insert({
      order_no,
      branch_id: d.branch_id,
      business_unit_id: businessUnitId,
      source_id: d.source_id || null,
      billing_to_id: d.billing_to_id || null,
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
    .eq('order_id', orderId);
  const subtotal = (items ?? []).reduce((s, i) => s + i.list_price_cents, 0);
  const discount = (items ?? []).reduce((s, i) => s + i.discount_amount_cents, 0);
  const total = (items ?? []).reduce((s, i) => s + i.final_amount_cents, 0);
  await supabase
    .from('orders')
    .update({ subtotal_cents: subtotal, discount_cents: discount, total_cents: total })
    .eq('id', orderId);
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

export async function addOrderItem(input: unknown): Promise<ActionResult> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();

  // Service item → category, duration
  const { data: svc, error: se } = await supabase
    .from('service_items')
    .select('id, service_category_id, duration_minutes')
    .eq('id', d.service_item_id)
    .single();
  if (se || !svc) return { ok: false, error: 'Service item not found' };

  // A station must be active to be assigned (cleaning/maintenance/closed reject).
  if (d.resource_id) {
    const { data: resource } = await supabase
      .from('resources')
      .select('status')
      .eq('id', d.resource_id)
      .single();
    if (!resource) return { ok: false, error: 'Station not found' };
    if (resource.status !== 'active') return { ok: false, error: `Station is ${resource.status}, not available` };
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
  if (!priceRow) return { ok: false, error: 'No list price set for this service. Set one in Service Items.' };
  const listPrice = priceRow.price_cents;

  // Discount
  const { data: disc, error: de } = await supabase
    .from('discount_classes')
    .select('code, discount_percent, discount_amount_cents')
    .eq('id', d.discount_class_id)
    .single();
  if (de || !disc) return { ok: false, error: 'Discount class not found' };

  if (MANAGER_DISCOUNTS.includes(disc.code) && !isManager(await currentSession())) {
    return { ok: false, error: `${disc.code} requires manager permission` };
  }

  let discountAmount = 0;
  if (disc.code === 'DIS-90') {
    discountAmount = listPrice; // complaint — 100% off
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

  const { error } = await supabase.from('order_items').insert({
    order_id: d.order_id,
    order_customer_id: d.order_customer_id,
    service_item_id: d.service_item_id,
    service_category_id: svc.service_category_id,
    therapist_id: d.therapist_id || null,
    therapist_home_branch_id: therapistHomeBranch,
    resource_id: d.resource_id || null,
    duration_minutes: svc.duration_minutes,
    list_price_cents: listPrice,
    discount_class_id: d.discount_class_id,
    discount_amount_cents: discountAmount,
    final_amount_cents: finalAmount,
    status: 'scheduled',
  });
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
export async function startOrderItem(itemId: string, orderId: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // No double-booking: the therapist and the station can't already be mid-service
  // on another line.
  const { data: item } = await supabase
    .from('order_items')
    .select('therapist_id, resource_id')
    .eq('id', itemId)
    .single();
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
  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
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
    status: 'submitted',
    filled_via: 'counter',
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

  // Tips are only recorded on a PAYMAYA payment (cash tips never enter the system).
  const tips = d.tips ?? [];
  if (tips.length > 0 && method?.code !== 'paymaya') {
    return { ok: false, error: 'Tips can only be recorded on a PAYMAYA payment' };
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
