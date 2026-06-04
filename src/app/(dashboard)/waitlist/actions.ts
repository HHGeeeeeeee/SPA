'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { nextOrderNo } from '@/lib/order-no';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const addSchema = z.object({
  branch_id: z.string().uuid(),
  customer_name: z.string().min(1).max(120),
  customer_phone: z.string().max(40).optional().nullable(),
  pax: z.coerce.number().int().min(1).max(20),
  note: z.string().max(200).optional().nullable(),
});

export async function addToWaitlist(input: unknown): Promise<ActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const { data: last } = await supabase
    .from('waitlist').select('position').eq('branch_id', d.branch_id).eq('status', 'waiting')
    .order('position', { ascending: false }).limit(1);
  const position = (last?.[0]?.position ?? 0) + 1;
  const { error } = await supabase.from('waitlist').insert({
    branch_id: d.branch_id,
    customer_name: d.customer_name,
    customer_phone: d.customer_phone || null,
    pax: d.pax,
    note: d.note || null,
    position,
    status: 'waiting',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/waitlist');
  return { ok: true };
}

export async function setWaitlistStatus(id: string, status: 'notified' | 'cancelled' | 'walked_away'): Promise<ActionResult> {
  const supabase = await createAuditedClient();
  const patch: { status: string; notified_at?: string } = { status };
  if (status === 'notified') patch.notified_at = new Date().toISOString();
  const { error } = await supabase.from('waitlist').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/waitlist');
  return { ok: true };
}

// Seat the party: open a walk-in draft order for the branch with the guest as
// the first customer and link it back to the waitlist entry.
export async function convertWaitlistToOrder(id: string): Promise<ActionResult<{ orderId: string }>> {
  const supabase = await createAuditedClient();
  const { data: w } = await supabase
    .from('waitlist').select('branch_id, customer_name, customer_phone, status').eq('id', id).single();
  if (!w) return { ok: false, error: 'Waitlist entry not found' };
  if (w.status === 'seated') return { ok: false, error: 'Already seated' };

  const { data: branch } = await supabase.from('branches').select('code, branch_business_units ( business_unit_id )').eq('id', w.branch_id).single();
  if (!branch) return { ok: false, error: 'Branch not found' };
  const unitIds = (branch.branch_business_units ?? []).map((r) => r.business_unit_id);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const order_no = await nextOrderNo(supabase, today);

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      order_no, branch_id: w.branch_id, business_unit_id: unitIds.length === 1 ? unitIds[0] : null,
      order_type: 'walk_in', service_date: today, status: 'draft',
    })
    .select('id')
    .single();
  if (error || !order) return { ok: false, error: error?.message ?? 'Could not open order' };

  await supabase.from('order_customers').insert({
    order_id: order.id, customer_name: w.customer_name, customer_phone: w.customer_phone, seq_no: 1,
  });
  await supabase.from('waitlist').update({ status: 'seated', converted_to_order_id: order.id }).eq('id', id);

  revalidatePath('/waitlist');
  revalidatePath('/sales-orders');
  return { ok: true, data: { orderId: order.id } };
}
