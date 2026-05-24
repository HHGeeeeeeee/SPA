'use server';

import { revalidatePath } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export interface EodSummaryRow { label: string; amount_cents: number }
export interface EodRecord {
  status: string;
  opened_at: string;
  revenue_confirmed_at: string | null;
  balances_ok_at: string | null;
  closed_at: string | null;
  opened_by_name: string | null;
  closed_by_name: string | null;
}
export interface EodView {
  branchId: string;
  date: string;
  record: EodRecord | null;
  noShowCount: number;
  blocking: { order_no: string; status: string }[];
  nonArOutstandingCount: number;
  nonArOutstandingCents: number;
  revenue: EodSummaryRow[];
  payments: EodSummaryRow[];
  revenueTotalCents: number;
  paymentTotalCents: number;
}

async function arMethodId(supabase: ReturnType<typeof createServiceClient>): Promise<string | null> {
  const { data } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  return data?.id ?? null;
}

/** Snapshot for the End of Day page: the record (if any), step readiness, and the sales summary. */
export async function loadEod(branchId: string, date: string): Promise<EodView> {
  const supabase = createServiceClient();
  const arId = await arMethodId(supabase);

  const { data: rec } = await supabase
    .from('business_day_close')
    .select('status, opened_at, revenue_confirmed_at, balances_ok_at, closed_at, opened:staff_users!business_day_close_opened_by_fkey ( display_name ), closer:staff_users!business_day_close_closed_by_fkey ( display_name )')
    .eq('branch_id', branchId).eq('business_date', date).maybeSingle();
  const record: EodRecord | null = rec
    ? {
        status: rec.status, opened_at: rec.opened_at, revenue_confirmed_at: rec.revenue_confirmed_at,
        balances_ok_at: rec.balances_ok_at, closed_at: rec.closed_at,
        opened_by_name: one(rec.opened)?.display_name ?? null, closed_by_name: one(rec.closer)?.display_name ?? null,
      }
    : null;

  // Reservations that never showed (still reserved/confirmed, not converted) for the day.
  const { count: noShowCount } = await supabase
    .from('reservations').select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId).is('deleted_at', null).in('status', ['reserved', 'confirmed'])
    .gte('desired_service_start', `${date}T00:00:00+08:00`).lt('desired_service_start', `${nextDay(date)}T00:00:00+08:00`);

  // The day's orders (non-void) with billing + payments, for blocking/balance/summary.
  const { data: orders } = await supabase
    .from('orders')
    .select('order_no, status, total_cents, paid_cents, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id ), order_items ( final_amount_cents, status, service:service_items!order_items_service_item_id_fkey ( service_category_id ) ), payments ( amount_cents, method:payment_methods ( code, display_name ) )')
    .eq('branch_id', branchId).eq('service_date', date).is('deleted_at', null).neq('status', 'void');

  const isAR = (o: { billing: unknown }) => !!arId && one<{ default_payment_method_id: string | null }>(o.billing as never)?.default_payment_method_id === arId;

  // Blocking = not terminal and not auto-resolvable by Step 1 (paid / AR-completed).
  const blocking = (orders ?? [])
    .filter((o) => !['closed'].includes(o.status) && o.status !== 'paid' && !(o.status === 'completed' && isAR(o)))
    .map((o) => ({ order_no: o.order_no, status: o.status }));

  // Step 2: non-AR orders not fully settled.
  let nonArOutstandingCents = 0; let nonArOutstandingCount = 0;
  for (const o of orders ?? []) {
    if (isAR(o)) continue;
    const out = o.total_cents - o.paid_cents;
    if (out > 0) { nonArOutstandingCents += out; nonArOutstandingCount += 1; }
  }

  // Revenue by service category name; payments by method (+ AR as the AR-billed totals).
  const catIds = new Set<string>();
  for (const o of orders ?? []) for (const it of o.order_items ?? []) { const c = one<{ service_category_id: string }>(it.service); if (c) catIds.add(c.service_category_id); }
  const { data: cats } = await supabase.from('service_categories').select('id, name').in('id', [...catIds]);
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));

  const revenueByCat = new Map<string, number>();
  const payByMethod = new Map<string, number>();
  let arPaymentCents = 0;
  for (const o of orders ?? []) {
    for (const it of o.order_items ?? []) {
      if (it.status === 'cancelled') continue;
      const cid = one<{ service_category_id: string }>(it.service)?.service_category_id;
      const name = (cid && catName.get(cid)) || 'Service';
      revenueByCat.set(name, (revenueByCat.get(name) ?? 0) + (it.final_amount_cents ?? 0));
    }
    for (const p of o.payments ?? []) {
      const label = one<{ display_name: string }>(p.method)?.display_name ?? 'Payment';
      payByMethod.set(label, (payByMethod.get(label) ?? 0) + p.amount_cents);
    }
    if (isAR(o)) arPaymentCents += o.total_cents; // AR is invoiced — count the total as the AR "payment"
  }
  if (arPaymentCents > 0) payByMethod.set('AR (Account Receivable)', (payByMethod.get('AR (Account Receivable)') ?? 0) + arPaymentCents);

  const revenue = [...revenueByCat.entries()].map(([label, amount_cents]) => ({ label, amount_cents })).sort((a, b) => b.amount_cents - a.amount_cents);
  const payments = [...payByMethod.entries()].map(([label, amount_cents]) => ({ label, amount_cents })).sort((a, b) => b.amount_cents - a.amount_cents);

  return {
    branchId, date, record,
    noShowCount: noShowCount ?? 0,
    blocking,
    nonArOutstandingCount, nonArOutstandingCents,
    revenue, payments,
    revenueTotalCents: revenue.reduce((s, r) => s + r.amount_cents, 0),
    paymentTotalCents: payments.reduce((s, r) => s + r.amount_cents, 0),
  };
}

async function ensureRecord(supabase: ReturnType<typeof createServiceClient>, branchId: string, date: string, staffUserId: string | null) {
  const { data } = await supabase.from('business_day_close').select('id, status').eq('branch_id', branchId).eq('business_date', date).maybeSingle();
  if (data) return data;
  const { data: created } = await supabase
    .from('business_day_close')
    .insert({ branch_id: branchId, business_date: date, status: 'open', opened_by: staffUserId })
    .select('id, status').single();
  return created;
}

/** Step 1: cancel no-show reservations, close paid + AR-completed orders, verify nothing's stuck. */
export async function runRevenueCheck(branchId: string, date: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const rec = await ensureRecord(supabase, branchId, date, session?.staffUserId ?? null);
  if (rec?.status === 'closed') return { ok: false, error: 'Business day is already closed' };
  const arId = await arMethodId(supabase);

  // 1) No-show sweep.
  await supabase
    .from('reservations').update({ status: 'no_show' })
    .eq('branch_id', branchId).is('deleted_at', null).in('status', ['reserved', 'confirmed'])
    .gte('desired_service_start', `${date}T00:00:00+08:00`).lt('desired_service_start', `${nextDay(date)}T00:00:00+08:00`);

  // 2) Close paid + AR-completed orders.
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_no, status, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
    .eq('branch_id', branchId).eq('service_date', date).is('deleted_at', null)
    .in('status', ['paid', 'completed']);
  const now = new Date().toISOString();
  for (const o of orders ?? []) {
    const ar = !!arId && one<{ default_payment_method_id: string | null }>(o.billing)?.default_payment_method_id === arId;
    if (!(o.status === 'paid' || (o.status === 'completed' && ar))) continue;
    await supabase.from('orders').update({ status: 'closed' }).eq('id', o.id);
    await supabase.from('order_status_log').insert({ entity_type: 'order', entity_id: o.id, from_status: o.status, to_status: 'closed', reason: 'End of Day — Revenue Confirmation', changed_by_staff_id: session!.staffUserId, changed_at: now });
  }

  // 3) Anything still not terminal blocks the step.
  const { data: remaining } = await supabase
    .from('orders')
    .select('order_no, status, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
    .eq('branch_id', branchId).eq('service_date', date).is('deleted_at', null).not('status', 'in', '(closed,void)');
  const stuck = (remaining ?? []).filter((o) => {
    const ar = !!arId && one<{ default_payment_method_id: string | null }>(o.billing)?.default_payment_method_id === arId;
    return !(o.status === 'completed' && ar) && o.status !== 'paid';
  });
  if (stuck.length > 0) {
    return { ok: false, error: `${stuck.length} order(s) not ready (e.g. ${stuck.slice(0, 3).map((o) => `${o.order_no}:${o.status}`).join(', ')}). Finish/settle them first.` };
  }

  await supabase.from('business_day_close').update({ revenue_confirmed_at: now }).eq('branch_id', branchId).eq('business_date', date);
  revalidatePath('/reconciliation/end-of-day');
  return { ok: true };
}

/** Step 2: every non-AR order for the day must be fully settled (outstanding = 0). */
export async function runBalanceCheck(branchId: string, date: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const { data: rec } = await supabase.from('business_day_close').select('status, revenue_confirmed_at').eq('branch_id', branchId).eq('business_date', date).maybeSingle();
  if (!rec || !rec.revenue_confirmed_at) return { ok: false, error: 'Run Revenue Confirmation first' };
  if (rec.status === 'closed') return { ok: false, error: 'Business day is already closed' };

  const arId = await arMethodId(supabase);
  const { data: orders } = await supabase
    .from('orders')
    .select('order_no, total_cents, paid_cents, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
    .eq('branch_id', branchId).eq('service_date', date).is('deleted_at', null).neq('status', 'void');
  const unpaid = (orders ?? []).filter((o) => {
    const ar = !!arId && one<{ default_payment_method_id: string | null }>(o.billing)?.default_payment_method_id === arId;
    return !ar && o.total_cents - o.paid_cents > 0;
  });
  if (unpaid.length > 0) {
    return { ok: false, error: `${unpaid.length} non-AR order(s) still have an outstanding balance (e.g. ${unpaid.slice(0, 3).map((o) => o.order_no).join(', ')}).` };
  }

  await supabase.from('business_day_close').update({ balances_ok_at: new Date().toISOString() }).eq('branch_id', branchId).eq('business_date', date);
  revalidatePath('/reconciliation/end-of-day');
  return { ok: true };
}

/** Step 3: lock the business day. No new orders / payments for it afterward. */
export async function closeBusinessDay(branchId: string, date: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const { data: rec } = await supabase.from('business_day_close').select('status, balances_ok_at').eq('branch_id', branchId).eq('business_date', date).maybeSingle();
  if (!rec) return { ok: false, error: 'Run the checks first' };
  if (!rec.balances_ok_at) return { ok: false, error: 'Run Check Balances first' };
  if (rec.status === 'closed') return { ok: false, error: 'Already closed' };

  const { error } = await supabase
    .from('business_day_close')
    .update({ status: 'closed', closed_by: session!.staffUserId, closed_at: new Date().toISOString() })
    .eq('branch_id', branchId).eq('business_date', date);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/end-of-day');
  revalidatePath('/sales-orders');
  return { ok: true };
}

/** Day lock guard — used by order/payment entry points to block a closed day. */
export async function isBusinessDayClosed(branchId: string, date: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('business_day_close').select('status')
    .eq('branch_id', branchId).eq('business_date', date).eq('status', 'closed').maybeSingle();
  return !!data;
}
