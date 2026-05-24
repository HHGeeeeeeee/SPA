'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { isDayCashClosed } from '@/app/(dashboard)/reconciliation/cash/actions';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface ConfirmableOrder {
  id: string;
  order_no: string;
  status: string;
  order_type: string;
  pax: number;
  isAR: boolean;
  service_date: string;
  total_cents: number;
  cash_cents: number;
  paymaya_cents: number;
  billing_label: string | null;
  adjusted: boolean; // a reversal adjustment has been requested for this closed order
}

const ORDER_SELECT = `
  id, order_no, status, order_type, service_date, total_cents,
  billing:billing_destinations!orders_billing_to_id_fkey ( code, name, default_payment_method_id ),
  order_customers ( id ),
  payments ( amount_cents, method:payment_methods ( code ) )
`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrderRow(o: any, arMethodId: string | null): ConfirmableOrder {
  const b = one<{ code: string; name: string; default_payment_method_id: string | null }>(o.billing);
  const isAR = !!arMethodId && b?.default_payment_method_id === arMethodId;
  const pays = o.payments ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sumByCode = (code: string) => pays.filter((p: any) => one<{ code: string }>(p.method)?.code === code).reduce((s: number, p: any) => s + p.amount_cents, 0);
  return {
    id: o.id, order_no: o.order_no, status: o.status, order_type: o.order_type,
    pax: o.order_customers?.length ?? 0, isAR, service_date: o.service_date, total_cents: o.total_cents,
    cash_cents: sumByCode('cash'), paymaya_cents: sumByCode('paymaya'),
    billing_label: b ? `${b.code} — ${b.name}` : null,
    adjusted: false,
  };
}

/** Orders for a branch+date that the daily close will move to Closed. */
export async function loadConfirmable(branchId: string, date: string): Promise<ConfirmableOrder[]> {
  const supabase = createServiceClient();
  const arMethod = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arMethodId = arMethod.data?.id ?? null;

  const { data } = await supabase
    .from('orders').select(ORDER_SELECT)
    .eq('branch_id', branchId).eq('service_date', date).is('deleted_at', null)
    .in('status', ['paid', 'completed']);

  return (data ?? [])
    .map((o) => mapOrderRow(o, arMethodId))
    // Paid (self-pay collected) OR Completed-AR (invoiced). Completed non-AR isn't done yet.
    .filter((o) => o.status === 'paid' || (o.status === 'completed' && o.isAR));
}

/** Already-confirmed (Closed) orders for a branch — the Revenue Confirm history. */
export async function loadConfirmedHistory(branchId: string): Promise<ConfirmableOrder[]> {
  const supabase = createServiceClient();
  const arMethod = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arMethodId = arMethod.data?.id ?? null;

  const { data } = await supabase
    .from('orders').select(ORDER_SELECT)
    .eq('branch_id', branchId).is('deleted_at', null).eq('status', 'closed')
    .order('service_date', { ascending: false })
    .order('order_no', { ascending: false })
    .limit(300);

  const rows = (data ?? []).map((o) => mapOrderRow(o, arMethodId));
  // Flag orders that already have a reversal adjustment requested.
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: adj } = await supabase.from('order_adjustments').select('original_order_id').in('original_order_id', ids);
    const adjusted = new Set((adj ?? []).map((a) => a.original_order_id));
    for (const r of rows) r.adjusted = adjusted.has(r.id);
  }
  return rows;
}

export async function isCashClosed(branchId: string, date: string): Promise<boolean> {
  // All of the branch's configured shifts must be closed.
  return isDayCashClosed(branchId, date);
}

const schema = z.object({ branch_id: z.string().uuid(), date: z.string().min(1) });

export async function confirmRevenue(input: unknown): Promise<ActionResult<{ closed: number }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to confirm revenue' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { branch_id, date } = parsed.data;

  if (!(await isCashClosed(branch_id, date))) {
    return { ok: false, error: 'Close the Cash Reconciliation for this branch/day first' };
  }

  const eligible = await loadConfirmable(branch_id, date);
  if (eligible.length === 0) return { ok: false, error: 'No orders to confirm for this branch/day' };

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  for (const o of eligible) {
    // NOTE: ERP/GL posting is deferred — Revenue Confirm only closes the orders
    // for now. The Acumatica posting step will be wired in the ERP phase.
    const { error } = await supabase.from('orders').update({ status: 'closed' }).eq('id', o.id);
    if (error) return { ok: false, error: error.message };
    await supabase.from('order_status_log').insert({
      entity_type: 'order',
      entity_id: o.id,
      from_status: o.status,
      to_status: 'closed',
      reason: 'Daily Revenue Confirm',
      changed_by_staff_id: session!.staffUserId,
      changed_at: now,
    });
  }

  revalidatePath('/reconciliation/revenue-confirm');
  revalidatePath('/sales-orders');
  return { ok: true, data: { closed: eligible.length } };
}
