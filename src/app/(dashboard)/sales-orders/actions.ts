'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

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

export async function voidOrder(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('orders').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
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
});

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
    .select('discount_percent, discount_amount_cents')
    .eq('id', d.discount_class_id)
    .single();
  if (de || !disc) return { ok: false, error: 'Discount class not found' };
  let discountAmount = 0;
  if (disc.discount_percent > 0) discountAmount = Math.round((listPrice * disc.discount_percent) / 100);
  else if (disc.discount_amount_cents > 0) discountAmount = Math.min(disc.discount_amount_cents, listPrice);
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

// ---------------------------------------------------------------------------
// Payment + status machine
// ---------------------------------------------------------------------------

const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ['open', 'void'],
  open: ['in_service', 'void'],
  in_service: ['completed', 'void'],
  completed: ['paid', 'void'],
  paid: ['closed'],
};

export async function setOrderStatus(orderId: string, next: string): Promise<ActionResult> {
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
  if (next === 'paid' && order.paid_cents < order.total_cents) {
    return { ok: false, error: 'Order is not fully paid yet' };
  }
  const { error } = await supabase.from('orders').update({ status: next }).eq('id', orderId);
  if (error) return { ok: false, error: error.message };
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

  // Tips are only recorded on a PAYMAYA payment (cash tips never enter the system).
  const tips = d.tips ?? [];
  if (tips.length > 0) {
    const { data: pm } = await supabase
      .from('payment_methods')
      .select('code')
      .eq('id', d.payment_method_id)
      .single();
    if (pm?.code !== 'paymaya') {
      return { ok: false, error: 'Tips can only be recorded on a PAYMAYA payment' };
    }
  }

  const { data: payment, error: pe } = await supabase
    .from('payments')
    .insert({
      order_id: d.order_id,
      order_customer_id: d.order_customer_id || null,
      payment_method_id: d.payment_method_id,
      amount_cents: amountCents,
      payment_ref: d.payment_ref || null,
      paid_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (pe || !payment) return { ok: false, error: pe?.message ?? 'Payment insert failed' };

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
