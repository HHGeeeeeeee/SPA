'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface SoaCandidate {
  id: string;
  order_no: string;
  service_date: string;
  total_cents: number;
}

/** Closed AR orders for a billing destination in range, not yet on any SOA. */
export async function loadSoaCandidates(billingToId: string, from: string, to: string): Promise<SoaCandidate[]> {
  const supabase = createServiceClient();
  const [{ data: orders }, { data: taken }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_no, service_date, total_cents, status')
      .eq('billing_to_id', billingToId)
      .eq('status', 'closed')
      .is('deleted_at', null)
      .gte('service_date', from)
      .lte('service_date', to),
    supabase.from('revenue_soa_orders').select('order_id'),
  ]);
  const takenIds = new Set((taken ?? []).map((t) => t.order_id));
  return (orders ?? [])
    .filter((o) => !takenIds.has(o.id))
    .map((o) => ({ id: o.id, order_no: o.order_no, service_date: o.service_date, total_cents: o.total_cents }));
}

export interface SoaGuestLine { name: string; amount_cents: number }
export interface SoaOrderLine { id: string; order_no: string; service_date: string; total_cents: number; guests: SoaGuestLine[] }
export interface SoaGroup {
  billing_id: string;
  code: string;
  name: string;
  settlement_type: string;
  bookings: number;
  total_cents: number;
  orders: SoaOrderLine[];
}

/**
 * Every AR billing destination with closed orders in range that aren't on any
 * SOA yet — grouped, with per-guest detail. Drives the "Generate SOA" workspace.
 */
export async function loadSoaWorkspace(from: string, to: string): Promise<SoaGroup[]> {
  const supabase = createServiceClient();
  const { data: arMethod } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arId = arMethod?.id ?? null;
  if (!arId) return [];
  const { data: bills } = await supabase
    .from('billing_destinations')
    .select('id, code, name, settlement_type, default_payment_method_id')
    .eq('active', true);
  const billMap = new Map((bills ?? []).filter((b) => b.default_payment_method_id === arId).map((b) => [b.id, b]));
  if (billMap.size === 0) return [];

  const [{ data: orders }, { data: taken }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_no, service_date, total_cents, billing_to_id, order_customers ( id, customer_name, seq_no ), order_items ( order_customer_id, final_amount_cents, status )')
      .in('billing_to_id', [...billMap.keys()])
      .eq('status', 'closed')
      .is('deleted_at', null)
      .gte('service_date', from)
      .lte('service_date', to)
      .order('service_date'),
    supabase.from('revenue_soa_orders').select('order_id'),
  ]);
  const takenIds = new Set((taken ?? []).map((t) => t.order_id));

  const groups = new Map<string, SoaGroup>();
  for (const o of orders ?? []) {
    if (takenIds.has(o.id) || !o.billing_to_id) continue;
    const b = billMap.get(o.billing_to_id);
    if (!b) continue;
    const name = new Map((o.order_customers ?? []).map((c) => [c.id, c.customer_name]));
    const seq = new Map((o.order_customers ?? []).map((c) => [c.id, c.seq_no]));
    const byCust = new Map<string, number>();
    for (const it of o.order_items ?? []) {
      if (it.status === 'cancelled' || !it.order_customer_id) continue;
      byCust.set(it.order_customer_id, (byCust.get(it.order_customer_id) ?? 0) + (it.final_amount_cents ?? 0));
    }
    const guests: SoaGuestLine[] = [...byCust.entries()]
      .map(([cid, amt]) => ({ name: name.get(cid) ?? 'Guest', amount_cents: amt, _seq: seq.get(cid) ?? 99 }))
      .sort((a, b2) => a._seq - b2._seq)
      .map(({ name: n, amount_cents }) => ({ name: n, amount_cents }));

    const g = groups.get(b.id) ?? { billing_id: b.id, code: b.code, name: b.name, settlement_type: b.settlement_type, bookings: 0, total_cents: 0, orders: [] };
    g.bookings += 1;
    g.total_cents += o.total_cents;
    g.orders.push({ id: o.id, order_no: o.order_no, service_date: o.service_date, total_cents: o.total_cents, guests });
    groups.set(b.id, g);
  }
  return [...groups.values()].sort((a, b) => b.total_cents - a.total_cents);
}

/** Generate one SOA per selected billing destination over the same period. */
export async function generateSOAForBillings(billingIds: string[], from: string, to: string): Promise<ActionResult<{ created: number }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  if (!billingIds.length) return { ok: false, error: 'Select at least one billing destination' };
  let created = 0;
  const errors: string[] = [];
  for (const id of billingIds) {
    const r = await generateSOA({ billing_to_id: id, period_from: from, period_to: to });
    if (r.ok) created += 1;
    else errors.push(r.error);
  }
  if (created === 0) return { ok: false, error: errors[0] ?? 'Nothing to generate' };
  revalidatePath('/reconciliation/soa');
  return { ok: true, data: { created } };
}

const createSchema = z.object({
  billing_to_id: z.string().uuid(),
  period_from: z.string().min(1),
  period_to: z.string().min(1),
});

export async function generateSOA(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { billing_to_id, period_from, period_to } = parsed.data;
  if (period_to < period_from) return { ok: false, error: 'End date must be on/after start date' };

  const supabase = createServiceClient();
  const { data: billing } = await supabase
    .from('billing_destinations')
    .select('code, settlement_type, credit_terms_days')
    .eq('id', billing_to_id)
    .single();
  if (!billing) return { ok: false, error: 'Billing destination not found' };

  const candidates = await loadSoaCandidates(billing_to_id, period_from, period_to);
  if (candidates.length === 0) return { ok: false, error: 'No un-SOA’d closed orders for this billing/period' };
  const subtotal = candidates.reduce((s, c) => s + c.total_cents, 0);

  const ym = period_from.replace(/-/g, '').slice(0, 6);
  const prefix = `SOA-${ym}-${billing.code}-`;
  const { data: last } = await supabase
    .from('revenue_soa').select('soa_no').like('soa_no', `${prefix}%`).order('soa_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.soa_no ? Number(last[0].soa_no.slice(prefix.length)) : 0;
  const soa_no = `${prefix}${String(seq + 1).padStart(3, '0')}`;

  const { data: soa, error } = await supabase
    .from('revenue_soa')
    .insert({
      soa_no, billing_to_id, period_from, period_to,
      settlement_type: billing.settlement_type,
      subtotal_cents: subtotal, total_cents: subtotal, paid_cents: 0, outstanding_cents: subtotal,
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !soa) return { ok: false, error: error?.message ?? 'Could not create SOA' };

  const { error: le } = await supabase.from('revenue_soa_orders').insert(
    candidates.map((c) => ({ soa_id: soa.id, order_id: c.id, amount_cents: c.total_cents })),
  );
  if (le) return { ok: false, error: le.message };

  revalidatePath('/reconciliation/soa');
  return { ok: true, data: { id: soa.id } };
}

export async function issueSOA(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const { data: soa } = await supabase
    .from('revenue_soa')
    .select('status, period_to, settlement_type, billing:billing_destinations!revenue_soa_billing_to_id_fkey ( credit_terms_days )')
    .eq('id', id)
    .single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (soa.status !== 'draft') return { ok: false, error: 'Only a draft SOA can be issued' };
  const today = new Date().toISOString().slice(0, 10);
  const creditDays = one(soa.billing)?.credit_terms_days ?? 0;
  const due = soa.settlement_type === 'third_party' && creditDays > 0
    ? new Date(Date.now() + creditDays * 86400000).toISOString().slice(0, 10)
    : null;
  const { error } = await supabase.from('revenue_soa').update({ status: 'issued', issued_date: today, due_date: due }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/soa');
  return { ok: true };
}

export async function settleSOA(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const { data: soa } = await supabase.from('revenue_soa').select('status, total_cents').eq('id', id).single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (!['issued', 'partial_paid'].includes(soa.status)) return { ok: false, error: 'Only an issued SOA can be settled' };
  // NOTE: ERP settle posting deferred. Marks the statement fully settled.
  const { error } = await supabase
    .from('revenue_soa')
    .update({ status: 'settled', paid_cents: soa.total_cents, outstanding_cents: 0 })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/soa');
  return { ok: true };
}

export async function voidSOA(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  // Release the orders so they can be re-stated.
  await supabase.from('revenue_soa_orders').delete().eq('soa_id', id);
  const { error } = await supabase.from('revenue_soa').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/soa');
  return { ok: true };
}
