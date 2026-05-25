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

export interface SoaItemLine {
  guest: string;
  service: string;
  duration_minutes: number | null;
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
}
export interface SoaOrderLine { id: string; order_no: string; service_date: string; total_cents: number; lines: SoaItemLine[] }
export interface SoaGroup {
  billing_id: string;
  code: string;
  name: string;
  settlement_type: string;
  bookings: number;
  total_cents: number;
  orders: SoaOrderLine[];
}

// Raw order shape (with guests + service lines) as selected for SOA detail.
interface RawSoaOrder {
  id: string;
  order_no: string;
  service_date: string;
  total_cents: number;
  order_customers: { id: string; customer_name: string; seq_no: number }[] | null;
  order_items: {
    order_customer_id: string | null;
    duration_minutes: number | null;
    list_price_cents: number | null;
    discount_amount_cents: number | null;
    final_amount_cents: number | null;
    status: string;
    service: { name: string } | { name: string }[] | null;
  }[] | null;
}

// One order → its SOA order line, with a per-service-line breakdown ordered by
// guest seq. Shared by the Generate workspace and the History detail.
function toSoaOrderLine(o: RawSoaOrder): SoaOrderLine {
  const name = new Map((o.order_customers ?? []).map((c) => [c.id, c.customer_name]));
  const seq = new Map((o.order_customers ?? []).map((c) => [c.id, c.seq_no]));
  const lines: SoaItemLine[] = (o.order_items ?? [])
    .filter((it) => it.status !== 'cancelled')
    .map((it) => ({
      guest: name.get(it.order_customer_id ?? '') ?? 'Guest',
      _seq: seq.get(it.order_customer_id ?? '') ?? 99,
      service: one(it.service)?.name ?? 'Service',
      duration_minutes: it.duration_minutes,
      gross_cents: it.list_price_cents ?? 0,
      discount_cents: it.discount_amount_cents ?? 0,
      net_cents: it.final_amount_cents ?? 0,
    }))
    .sort((a, b) => a._seq - b._seq)
    .map(({ _seq, ...rest }) => rest);
  return { id: o.id, order_no: o.order_no, service_date: o.service_date, total_cents: o.total_cents, lines };
}

export interface SoaHistoryRow {
  id: string;
  soa_no: string;
  status: string;
  settlement_type: string | null;
  period_from: string;
  period_to: string;
  total_cents: number;
  billing_code: string | null;
  billing_name: string | null;
  // The orders stated on this SOA (for the expandable History detail). Empty for
  // voided statements — voiding releases the order links.
  detail: SoaOrderLine[];
}

/** All statements, newest first, each with its stated-orders detail. */
export async function loadSoaHistory(): Promise<SoaHistoryRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('revenue_soa')
    .select(`
      id, soa_no, status, settlement_type, period_from, period_to, total_cents,
      billing:billing_destinations!revenue_soa_billing_to_id_fkey ( code, name ),
      revenue_soa_orders (
        order:orders (
          id, order_no, service_date, total_cents,
          order_customers ( id, customer_name, seq_no ),
          order_items ( order_customer_id, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, status, service:service_items ( name ) )
        )
      )
    `)
    .order('created_at', { ascending: false });
  return (data ?? []).map((s) => {
    const b = one(s.billing);
    const detail = (s.revenue_soa_orders ?? [])
      .map((link) => one(link.order) as RawSoaOrder | null)
      .filter((o): o is RawSoaOrder => Boolean(o))
      .map(toSoaOrderLine)
      .sort((a, c) => a.service_date.localeCompare(c.service_date) || a.order_no.localeCompare(c.order_no));
    return {
      id: s.id, soa_no: s.soa_no, status: s.status, settlement_type: s.settlement_type,
      period_from: s.period_from, period_to: s.period_to, total_cents: s.total_cents,
      billing_code: b?.code ?? null, billing_name: b?.name ?? null, detail,
    };
  });
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
      .select('id, order_no, service_date, total_cents, billing_to_id, order_customers ( id, customer_name, seq_no ), order_items ( order_customer_id, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, status, service:service_items ( name ) )')
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
    const g = groups.get(b.id) ?? { billing_id: b.id, code: b.code, name: b.name, settlement_type: b.settlement_type, bookings: 0, total_cents: 0, orders: [] };
    g.bookings += 1;
    g.total_cents += o.total_cents;
    g.orders.push(toSoaOrderLine(o as unknown as RawSoaOrder));
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

/** Settle several issued/partial_paid SOAs in one pass (batch from History). */
export async function settleSOABatch(ids: string[]): Promise<ActionResult<{ settled: number }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  if (!ids.length) return { ok: false, error: 'Select at least one issued SOA' };
  let settled = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const r = await settleSOA(id);
    if (r.ok) settled += 1;
    else errors.push(r.error);
  }
  if (settled === 0) return { ok: false, error: errors[0] ?? 'Nothing to settle' };
  revalidatePath('/reconciliation/soa');
  return { ok: true, data: { settled } };
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
