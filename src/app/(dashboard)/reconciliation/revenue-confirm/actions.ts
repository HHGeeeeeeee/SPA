'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { isDayCashClosed } from '@/app/(dashboard)/reconciliation/cash/actions';
import { postToErp, type PostToErpResult } from '@/lib/erp-posting';
import type { GLLine } from '@/lib/acumatica';
import { assertNoBlockedClose } from '@/lib/business-day';

const REVENUE_ACCOUNT = '40140'; // services revenue
const TIPS_PAYABLE = '20500'; // tip liability — paired with PAYMAYA tip code

interface TxAccounts {
  debit_account: string | null;
  debit_subaccount: string | null;
  credit_account: string | null;
  credit_subaccount: string | null;
}

/** Look up a posting transaction_code by (branch, method, credit_account). The
 *  credit side disambiguates: 40140 = revenue recognition, 20500 = tip payable. */
async function lookupTx(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  branchId: string,
  methodId: string,
  creditAccount: string,
): Promise<TxAccounts | null> {
  const { data } = await supabase
    .from('transaction_codes')
    .select('debit_account, debit_subaccount, credit_account, credit_subaccount')
    .eq('branch_id', branchId)
    .eq('payment_method_id', methodId)
    .eq('credit_account', creditAccount)
    .eq('active', true)
    .maybeSingle();
  return data;
}

/**
 * Compose + post the daily revenue journal for a single order. AR orders post
 * DR 10200 AR / CR 40140 Revenue (no actual payments collected). Counter orders
 * sum each payment method's bill amount → DR per method's debit account (from
 * transaction_codes) / CR Revenue 40140. PAYMAYA tips ride along as a separate
 * DR PAYMAYA (10121) / CR Tips Payable (20500) pair; accounts shared with the
 * bill PAYMAYA line aggregate naturally. Posts via postToErp (status revert on
 * failure, gl_batch_nbr written on success). Skipped end-to-end when Acumatica
 * isn't configured (status just flips to closed, no GL call).
 */
async function postOrderRevenueToErp(orderId: string, arMethodId: string | null): Promise<PostToErpResult> {
  const supabase = await createAuditedClient();
  const { data: o } = await supabase
    .from('orders')
    .select(`
      id, order_no, status, service_date, total_cents, branch_id,
      branch:branches!orders_branch_id_fkey ( code ),
      billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id ),
      payments ( amount_cents, payment_method_id ),
      tips ( amount_cents )
    `)
    .eq('id', orderId)
    .single();
  if (!o || !o.branch_id) return { ok: false, error: 'Order or branch not found' };

  const branchCode = one<{ code: string }>(o.branch)?.code ?? '';
  const billing = one<{ default_payment_method_id: string | null }>(o.billing);
  const isAR = !!arMethodId && billing?.default_payment_method_id === arMethodId;

  // Aggregate the order's bill side by payment method (in cents).
  const billByMethod = new Map<string, number>();
  for (const p of o.payments ?? []) {
    if (!p.payment_method_id) continue;
    billByMethod.set(p.payment_method_id, (billByMethod.get(p.payment_method_id) ?? 0) + p.amount_cents);
  }
  const tipsTotal = (o.tips ?? []).reduce((s, t) => s + t.amount_cents, 0);

  // One ledger keyed by account+sub — same account from multiple sources
  // (e.g. PAYMAYA bill + PAYMAYA tip → DR 10121) aggregates into one line.
  const ledger = new Map<string, { sub: string; dr: number; cr: number; desc: string }>();
  function add(account: string, sub: string | null, drCents: number, crCents: number, desc: string) {
    const subUse = (sub && sub.length > 0 ? sub : '000000000');
    const key = `${account}|${subUse}`;
    const cur = ledger.get(key) ?? { sub: subUse, dr: 0, cr: 0, desc };
    cur.dr += drCents;
    cur.cr += crCents;
    ledger.set(key, cur);
  }

  if (isAR && arMethodId) {
    // AR-billed order: DR 10200 / CR 40140 = total.
    const tx = await lookupTx(supabase, o.branch_id, arMethodId, REVENUE_ACCOUNT);
    if (!tx?.debit_account || !tx?.credit_account) {
      return { ok: false, error: `Missing AR revenue tx code for this branch` };
    }
    add(tx.debit_account, tx.debit_subaccount, o.total_cents, 0, `${o.order_no} AR`);
    add(tx.credit_account, tx.credit_subaccount, 0, o.total_cents, `${o.order_no} revenue`);
  } else {
    for (const [methodId, amount] of billByMethod) {
      if (amount === 0) continue;
      const tx = await lookupTx(supabase, o.branch_id, methodId, REVENUE_ACCOUNT);
      if (!tx?.debit_account || !tx?.credit_account) {
        return { ok: false, error: `Missing revenue tx code for a payment method on ${o.order_no}` };
      }
      add(tx.debit_account, tx.debit_subaccount, amount, 0, `${o.order_no} receipt`);
      add(tx.credit_account, tx.credit_subaccount, 0, amount, `${o.order_no} revenue`);
    }
  }

  // Tips (PAYMAYA only — cash tips never enter the system): DR PAYMAYA /
  // CR Tips Payable. Looked up by credit_account=20500 (the tip code's CR side).
  if (tipsTotal > 0) {
    const { data: paymayaPm } = await supabase.from('payment_methods').select('id').eq('code', 'paymaya').maybeSingle();
    if (paymayaPm) {
      const tipTx = await lookupTx(supabase, o.branch_id, paymayaPm.id, TIPS_PAYABLE);
      if (tipTx?.debit_account && tipTx?.credit_account) {
        add(tipTx.debit_account, tipTx.debit_subaccount, tipsTotal, 0, `${o.order_no} tip`);
        add(tipTx.credit_account, tipTx.credit_subaccount, 0, tipsTotal, `${o.order_no} tip payable`);
      }
    }
  }

  const lines: GLLine[] = [...ledger.entries()].map(([k, v]) => ({
    account: k.split('|')[0],
    sub_account: v.sub,
    debit_amount: v.dr > 0 ? v.dr / 100 : null,
    credit_amount: v.cr > 0 ? v.cr / 100 : null,
    transaction_desc: v.desc,
  }));

  return await postToErp({
    entityType: 'revenue_confirm',
    table: 'orders',
    entityId: orderId,
    date: o.service_date,
    branch: branchCode,
    description: `Revenue ${o.order_no}`,
    lines,
    fromStatus: o.status,
    toStatus: 'closed',
  });
}

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
  };
}

/** Orders for a branch+date that the daily close will move to Closed. */
export async function loadConfirmable(branchId: string, date: string): Promise<ConfirmableOrder[]> {
  const supabase = await createAuditedClient();
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
  const supabase = await createAuditedClient();
  const arMethod = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arMethodId = arMethod.data?.id ?? null;

  const { data } = await supabase
    .from('orders').select(ORDER_SELECT)
    .eq('branch_id', branchId).is('deleted_at', null).eq('status', 'closed')
    .order('service_date', { ascending: false })
    .order('order_no', { ascending: false })
    .limit(300);

  return (data ?? []).map((o) => mapOrderRow(o, arMethodId));
}

export async function isCashClosed(branchId: string, date: string): Promise<boolean> {
  // All of the branch's configured shifts must be closed.
  return isDayCashClosed(branchId, date);
}

const schema = z.object({ branch_id: z.string().uuid(), date: z.string().min(1) });

export async function confirmRevenue(input: unknown): Promise<ActionResult<{ closed: number; failed: number; first_error?: string }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to confirm revenue' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { branch_id, date } = parsed.data;
  if (!(await canAccessBranch(branch_id))) return { ok: false, error: 'No access to this branch' };
  try {
    await assertNoBlockedClose(branch_id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  if (!(await isCashClosed(branch_id, date))) {
    return { ok: false, error: 'Close the Shift Cash Count for this branch/day first' };
  }

  const eligible = await loadConfirmable(branch_id, date);
  if (eligible.length === 0) return { ok: false, error: 'No orders to confirm for this branch/day' };

  const supabase = await createAuditedClient();
  const { data: arRow } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arMethodId = arRow?.id ?? null;

  // Per-order ERP post. Each order = one GL journal (DR money / CR revenue +
  // tip pair). A single failure doesn't block the batch — successful orders
  // close cleanly with a batch number; failures stay in their prior status with
  // posting_status='failed' + posting_error (retriable from the order page).
  const now = new Date().toISOString();
  const errors: string[] = [];
  let closed = 0;
  for (const o of eligible) {
    const r = await postOrderRevenueToErp(o.id, arMethodId);
    if (r.ok) {
      closed += 1;
      await supabase.from('order_status_log').insert({
        entity_type: 'order',
        entity_id: o.id,
        from_status: o.status,
        to_status: 'closed',
        reason: 'Daily Revenue Confirm',
        changed_by_staff_id: session!.staffUserId,
        changed_at: now,
      });
    } else {
      errors.push(`${o.order_no}: ${r.error}`);
    }
  }

  revalidatePath('/reconciliation/revenue-confirm');
  revalidatePath('/sales-orders');

  if (closed === 0) return { ok: false, error: errors[0] ?? 'Could not close any orders' };
  return { ok: true, data: { closed, failed: errors.length, first_error: errors[0] } };
}

/** Re-attempt the ERP post for an order whose Revenue Confirm posting failed.
 *  Manager-gated; refuses when the order is already closed or never failed. */
export async function retryOrderRevenuePosting(orderId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: o } = await supabase.from('orders').select('branch_id, status').eq('id', orderId).maybeSingle();
  if (!o) return { ok: false, error: 'Order not found' };
  if (!o.branch_id || !(await canAccessBranch(o.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (o.status === 'closed') return { ok: false, error: 'Order is already closed' };
  try {
    await assertNoBlockedClose(o.branch_id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // posting_status isn't in the generated DB types yet — cast read.
  const sb = supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { posting_status: string | null } | null }> } } };
  };
  const pr = await sb.from('orders').select('posting_status').eq('id', orderId).maybeSingle();
  if (pr.data?.posting_status !== 'failed') return { ok: false, error: 'Posting is not in a failed state' };

  const { data: arRow } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const r = await postOrderRevenueToErp(orderId, arRow?.id ?? null);
  if (r.ok) {
    await supabase.from('order_status_log').insert({
      entity_type: 'order', entity_id: orderId,
      from_status: o.status, to_status: 'closed',
      reason: 'Revenue Confirm Retry',
      changed_by_staff_id: session!.staffUserId, changed_at: new Date().toISOString(),
    });
  }
  revalidatePath('/reconciliation/revenue-confirm');
  revalidatePath(`/sales-orders/${orderId}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}
