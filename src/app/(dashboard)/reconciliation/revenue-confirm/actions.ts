'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { isDayCashClosed } from '@/app/(dashboard)/reconciliation/cash/actions';
import { acumaticaConfigured } from '@/lib/erp-posting';
import { pushGLEntry, attachFileToJournal, type GLLine } from '@/lib/acumatica';
import { readAcuSessionCookie } from '@/lib/session';
import { createServiceClient } from '@/lib/supabase/server';
import { renderRevenueConfirmPdf } from '@/lib/revenue-confirm-pdf';
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
/** Build the per-order GL lines (DR money / CR revenue + tip pair). Returns
 *  the lines plus the order's branch_id/code so the caller can batch many
 *  orders into one journal. Pure compute — no DB writes, no ERP push.
 *
 *  An order's lines stay aggregated WITHIN the order (e.g. PAYMAYA payment +
 *  PAYMAYA tip share one DR 10121 line tagged with the order_no) but are NOT
 *  merged across orders — every order keeps its own per-account lines so the
 *  posted GL voucher shows each order's full detail (user requirement). */
async function buildOrderRevenueLines(
  orderId: string,
  arMethodId: string | null,
): Promise<{ ok: true; lines: GLLine[]; branchId: string; branchCode: string; orderNo: string; serviceDate: string } | { ok: false; error: string }> {
  const supabase = await createAuditedClient();
  const { data: o } = await supabase
    .from('orders')
    .select(`
      id, order_no, status, service_date, total_cents, branch_id,
      branch:branches!orders_branch_id_fkey ( code ),
      billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id ),
      folio_lines ( amount_cents, kind, payment_method_id ),
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
  for (const p of o.folio_lines ?? []) {
    if (!p.payment_method_id || !['payment', 'refund'].includes(p.kind)) continue;
    billByMethod.set(p.payment_method_id, (billByMethod.get(p.payment_method_id) ?? 0) + (p.kind === 'refund' ? -p.amount_cents : p.amount_cents));
  }
  const tipsTotal = (o.tips ?? []).reduce((s, t) => s + t.amount_cents, 0);

  // Ledger scoped to THIS order — same account from multiple sources
  // (e.g. PAYMAYA bill + PAYMAYA tip → DR 10121) aggregates within the order.
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
      return { ok: false, error: `${o.order_no}: missing AR revenue tx code` };
    }
    add(tx.debit_account, tx.debit_subaccount, o.total_cents, 0, `${o.order_no} AR`);
    add(tx.credit_account, tx.credit_subaccount, 0, o.total_cents, `${o.order_no} revenue`);
  } else {
    for (const [methodId, amount] of billByMethod) {
      if (amount === 0) continue;
      const tx = await lookupTx(supabase, o.branch_id, methodId, REVENUE_ACCOUNT);
      if (!tx?.debit_account || !tx?.credit_account) {
        return { ok: false, error: `${o.order_no}: missing revenue tx code for a payment method` };
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

  return { ok: true, lines, branchId: o.branch_id, branchCode, orderNo: o.order_no, serviceDate: o.service_date };
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
  total_cents: number;     // Sales side (Cash + PAYMAYA + AR sums to this for paid orders)
  cash_cents: number;      // Sales
  paymaya_cents: number;   // Sales
  /** Pass-through tip (PAYMAYA only). Collected on behalf of the therapist;
   *  posted as DR 10121 / CR 20500 — does not affect revenue. Shown in its
   *  own "Pass-through" column on the Revenue Confirm grid. */
  tip_cents: number;
  billing_label: string | null;
  /** Acumatica GL voucher number from the day's batched Revenue Confirm. Null
   *  if not yet posted (or this order was confirmed before ERP wiring). */
  gl_batch_nbr: string | null;
}

const ORDER_SELECT = `
  id, order_no, status, order_type, service_date, total_cents, gl_batch_nbr,
  billing:billing_destinations!orders_billing_to_id_fkey ( code, name, default_payment_method_id ),
  order_customers ( id ),
  folio_lines ( amount_cents, kind, method:payment_methods ( code ) ),
  tips ( amount_cents )
`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrderRow(o: any, arMethodId: string | null): ConfirmableOrder {
  const b = one<{ code: string; name: string; default_payment_method_id: string | null }>(o.billing);
  const isAR = !!arMethodId && b?.default_payment_method_id === arMethodId;
  const pays = (o.folio_lines ?? []).filter((p: any) => ['payment', 'refund'].includes(p.kind));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sumByCode = (code: string) => pays.filter((p: any) => one<{ code: string }>(p.method)?.code === code).reduce((s: number, p: any) => s + (p.kind === 'refund' ? -p.amount_cents : p.amount_cents), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tipsTotal = (o.tips ?? []).reduce((s: number, t: any) => s + (t.amount_cents ?? 0), 0);
  return {
    id: o.id, order_no: o.order_no, status: o.status, order_type: o.order_type,
    pax: o.order_customers?.length ?? 0, isAR, service_date: o.service_date, total_cents: o.total_cents,
    cash_cents: sumByCode('cash'), paymaya_cents: sumByCode('paymaya'),
    tip_cents: tipsTotal,
    billing_label: b ? `${b.code} — ${b.name}` : null,
    gl_batch_nbr: o.gl_batch_nbr ?? null,
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

/** Already-confirmed (Closed) orders for a branch — the Revenue Confirm history.
 *  Optional from/to (yyyy-mm-dd, inclusive) narrows by service_date. */
export async function loadConfirmedHistory(
  branchId: string,
  from?: string | null,
  to?: string | null,
): Promise<ConfirmableOrder[]> {
  const supabase = await createAuditedClient();
  const arMethod = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arMethodId = arMethod.data?.id ?? null;

  let q = supabase
    .from('orders').select(ORDER_SELECT)
    .eq('branch_id', branchId).is('deleted_at', null).eq('status', 'closed');
  if (from) q = q.gte('service_date', from);
  if (to) q = q.lte('service_date', to);
  const { data } = await q
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

export async function confirmRevenue(input: unknown): Promise<ActionResult<{ closed: number; failed: number; batchNbr?: string | null; first_error?: string }>> {
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
  const svc = createServiceClient(); // for updates that need to bypass RLS during the batch
  const { data: arRow } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arMethodId = arRow?.id ?? null;

  // --- Build aggregated GL lines (no DB writes, no ERP push yet) ---
  // One journal for the whole day: lines stay per-order (each tagged with the
  // order_no in transaction_desc) so the posted voucher shows full detail. If
  // ANY order fails to build (missing tx code, etc.) the whole batch aborts
  // before we touch ERP — atomic by design.
  const allLines: GLLine[] = [];
  let branchCode = '';
  for (const o of eligible) {
    const r = await buildOrderRevenueLines(o.id, arMethodId);
    if (!r.ok) return { ok: false, error: r.error };
    allLines.push(...r.lines);
    branchCode = r.branchCode;
  }

  const now = new Date().toISOString();
  const orderIds = eligible.map((o) => o.id);
  const orderNos = eligible.map((o) => o.order_no);

  // --- ERP not configured: just close all orders (dev / pre-integration mode) ---
  if (!acumaticaConfigured()) {
    for (const o of eligible) {
      await (svc.from('orders') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ status: 'closed' })
        .eq('id', o.id);
      await supabase.from('order_status_log').insert({
        entity_type: 'order', entity_id: o.id,
        from_status: o.status, to_status: 'closed',
        reason: 'Daily Revenue Confirm (no ERP)',
        changed_by_staff_id: session!.staffUserId, changed_at: now,
      });
    }
    revalidatePath('/reconciliation/revenue-confirm');
    revalidatePath('/sales-orders');
    return { ok: true, data: { closed: eligible.length, failed: 0, batchNbr: null } };
  }

  // --- Atomic batch post ---
  // Mark all eligible orders as posting (audit trail + visible spinner state).
  await (svc.from('orders') as unknown as { update: (p: Record<string, unknown>) => { in: (c: string, ids: string[]) => Promise<unknown> } })
    .update({ posting_status: 'posting', posting_error: null })
    .in('id', orderIds);

  // Log row for the whole batch — entity_id is the first order id as an anchor,
  // payload carries all order ids + count for traceability.
  const { data: logRow } = await (supabase.from('erp_posting_log') as unknown as {
    insert: (p: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null }> } };
  })
    .insert({
      entity_type: 'revenue_confirm_batch',
      entity_id: eligible[0].id,
      status: 'pending',
      payload: { kind: 'revenue_confirm', branch_id, date, order_ids: orderIds, order_nos: orderNos, count: eligible.length, lines: allLines },
      posted_by_staff_id: session?.staffUserId ?? null,
      acu_session_user_id: session?.acumaticaUserId ?? null,
    })
    .select('id')
    .single();

  try {
    const cookie = await readAcuSessionCookie();
    const res = await pushGLEntry(
      {
        date, // service_date (all eligible orders share it via loadConfirmable filter)
        branch: branchCode,
        description: `Revenue Confirm ${date} (${eligible.length} order${eligible.length > 1 ? 's' : ''})`,
        currency: 'PHP',
        lines: allLines,
      },
      cookie,
    );

    // Success: every order gets the SAME batch_nbr — one voucher, many orders.
    await (svc.from('orders') as unknown as { update: (p: Record<string, unknown>) => { in: (c: string, ids: string[]) => Promise<unknown> } })
      .update({ status: 'closed', gl_batch_nbr: res.batchNbr, posting_status: 'posted', posting_error: null })
      .in('id', orderIds);

    if (logRow) {
      await (supabase.from('erp_posting_log') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ status: 'success', batch_nbr: res.batchNbr, erp_response: res.raw })
        .eq('id', logRow.id);
    }

    // Best-effort attach the per-batch voucher PDF to the GL journal so the
    // Acumatica entry has the source detail next to it. Failure here doesn't
    // unwind the post — the GL is already correct and the PDF is regeneratable
    // on demand from /reconciliation/revenue-confirm/[batch]/pdf.
    if (res.batchNbr) {
      try {
        const pdf = await renderRevenueConfirmPdf(res.batchNbr);
        if (pdf) {
          // Copy into a plain ArrayBuffer so the type matches attachFileToJournal
          // (Node Buffer's underlying buffer may be a SharedArrayBuffer).
          const ab = new ArrayBuffer(pdf.buffer.byteLength);
          new Uint8Array(ab).set(pdf.buffer);
          await attachFileToJournal(
            { batchNbr: res.batchNbr, filename: pdf.filename, fileBuffer: ab, mimeType: 'application/pdf' },
            cookie,
          );
        }
      } catch (attachErr) {
        const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
        console.error('[Revenue Confirm attach] PDF attach failed:', msg);
        if (logRow) {
          await (supabase.from('erp_posting_log') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
            .update({ error_message: `Posted (GL ${res.batchNbr}) but PDF attach failed: ${msg}` })
            .eq('id', logRow.id);
        }
      }
    }

    for (const o of eligible) {
      await supabase.from('order_status_log').insert({
        entity_type: 'order', entity_id: o.id,
        from_status: o.status, to_status: 'closed',
        reason: `Daily Revenue Confirm · GL ${res.batchNbr ?? '?'}`,
        changed_by_staff_id: session!.staffUserId, changed_at: now,
      });
    }

    revalidatePath('/reconciliation/revenue-confirm');
    revalidatePath('/sales-orders');
    return { ok: true, data: { closed: eligible.length, failed: 0, batchNbr: res.batchNbr } };
  } catch (err) {
    const errMsg = (err as Error).message || 'GL push failed';
    // Revert: all orders go back to their prior status (status didn't change
    // yet, only posting_status); just stamp the error so it's visible.
    await (svc.from('orders') as unknown as { update: (p: Record<string, unknown>) => { in: (c: string, ids: string[]) => Promise<unknown> } })
      .update({ posting_status: 'failed', posting_error: errMsg })
      .in('id', orderIds);
    if (logRow) {
      await (supabase.from('erp_posting_log') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ status: 'failed', error_message: errMsg })
        .eq('id', logRow.id);
    }
    revalidatePath('/reconciliation/revenue-confirm');
    return { ok: false, error: errMsg };
  }
}

/** Re-attempt the ERP post for an order whose Revenue Confirm posting failed.
 *  Manager-gated; retries the WHOLE batch for that order's service_date (since
 *  Revenue Confirm now posts one journal per day-branch, not per order). The
 *  caller sees this as a per-order retry but it actually re-confirms every
 *  eligible order at the same branch+date. */
export async function retryOrderRevenuePosting(orderId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: o } = await supabase.from('orders').select('branch_id, service_date, status').eq('id', orderId).maybeSingle();
  if (!o) return { ok: false, error: 'Order not found' };
  if (!o.branch_id || !(await canAccessBranch(o.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (o.status === 'closed') return { ok: false, error: 'Order is already closed' };

  // Re-run confirmRevenue for the order's branch+date — it will pick up every
  // still-eligible order (including this one) and post them as one journal.
  const r = await confirmRevenue({ branch_id: o.branch_id, date: o.service_date });
  revalidatePath(`/sales-orders/${orderId}`);
  return r as ActionResult;
}
