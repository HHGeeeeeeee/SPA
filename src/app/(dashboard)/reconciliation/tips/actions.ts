'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertNoBlockedClose } from '@/lib/business-day';
import { postBillToErp, type PostToErpResult } from '@/lib/erp-posting';
import { renderTipPdf } from '@/lib/tip-pdf';

/** Compose the AP Bill (DR 20500 / sub 000000000, one line per therapist) and
 *  post via postBillToErp + attach the stored PDF. Shared by settleTips (first
 *  attempt) and retryTipPosting. Returns the posting result. */
async function postTipSettlementToErp(settlementId: string): Promise<PostToErpResult> {
  const supabase = await createAuditedClient();
  const { data: s } = await supabase
    .from('tip_settlements')
    .select('settlement_no, branch_id, period_from, period_to, branch:branches!tip_settlements_branch_id_fkey ( code )')
    .eq('id', settlementId)
    .single();
  if (!s) return { ok: false, error: 'Settlement not found' };

  // pdf_file_path isn't in generated types yet — cast read.
  const pdfRes = await (supabase.from('tip_settlements') as unknown as {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { pdf_file_path: string | null } | null }> } };
  })
    .select('pdf_file_path')
    .eq('id', settlementId)
    .maybeSingle();
  const pdfPath = pdfRes.data?.pdf_file_path ?? null;

  const { data: tipRows } = await supabase
    .from('tips')
    .select('amount_cents, therapist:employees!tips_therapist_id_fkey ( id, name ), order:orders!tips_order_id_fkey ( order_no )')
    .eq('settlement_id', settlementId);
  const byTherapist = new Map<string, { name: string; total: number; orders: Set<string> }>();
  for (const t of tipRows ?? []) {
    const th = one(t.therapist);
    const ord = one<{ order_no: string }>(t.order);
    if (!th) continue;
    const g = byTherapist.get(th.id) ?? { name: th.name ?? '—', total: 0, orders: new Set<string>() };
    g.total += t.amount_cents;
    if (ord?.order_no) g.orders.add(ord.order_no);
    byTherapist.set(th.id, g);
  }
  // Acumatica's TransactionDescr is capped (~256 chars). Order numbers can
  // pile up if a therapist had many tipped services in one settlement —
  // truncate with an ellipsis once we'd otherwise overflow, so the bill is
  // never rejected for description length.
  const apLines = [...byTherapist.values()].map((g) => {
    const orders = [...g.orders].sort().join(', ');
    const base = `Tips · ${g.name}`;
    const full = orders ? `${base} · ${orders}` : base;
    return {
      account: '20500',
      sub_account: '000000000',
      quantity: 1,
      unit_cost: g.total / 100,
      amount: g.total / 100,
      transaction_desc: full.length > 250 ? `${full.slice(0, 247)}...` : full,
    };
  });

  return await postBillToErp({
    entityType: 'tip_settlement',
    table: 'tip_settlements',
    entityId: settlementId,
    vendor: process.env.ACUMATICA_TIPS_VENDOR ?? '',
    vendorRef: s.settlement_no,
    date: new Date().toISOString().slice(0, 10),
    description: `Tip settlement ${s.settlement_no} (${s.period_from} to ${s.period_to})`,
    financialBranch: one<{ code: string }>(s.branch)?.code ?? '',
    cashAccount: process.env.ACUMATICA_TIPS_CASH_ACCOUNT ?? '',
    currency: 'PHP',
    lines: apLines,
    // HHG Acumatica requires these custom attributes on every AP Bill. Set
    // via env so non-tip flows (commission/expense) can override.
    requestCategory: process.env.ACUMATICA_TIPS_REQUEST_CATEGORY ?? '',
    paymentOrLiquidation: process.env.ACUMATICA_TIPS_PAYMENT_TYPE ?? '',
    proofPath: pdfPath ?? undefined,
    proofBucket: 'tip-pdfs',
  });
}

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface TipLine { id: string; service_date: string; order_no: string; amount_cents: number }
export interface TipGroup {
  therapist_id: string;
  therapist_name: string;
  count: number;
  total_cents: number;
  tips: TipLine[];
}

/** Open (unsettled) PAYMAYA tips for a branch in range, grouped by therapist. */
export async function loadOpenTipGroups(branchId: string, from: string, to: string): Promise<TipGroup[]> {
  const supabase = await createAuditedClient();
  const { data } = await supabase
    .from('tips')
    .select(`
      id, amount_cents, therapist_id, status, settlement_id,
      therapist:employees!tips_therapist_id_fkey ( name ),
      order:orders!tips_order_id_fkey ( order_no, service_date, status, branch_id )
    `)
    .is('settlement_id', null)
    .eq('status', 'open');

  const groups = new Map<string, TipGroup>();
  for (const t of data ?? []) {
    const ord = one(t.order);
    if (!ord || ord.branch_id !== branchId || ord.status === 'void') continue;
    if (ord.service_date < from || ord.service_date > to) continue;
    const th = one(t.therapist);
    const g = groups.get(t.therapist_id) ?? { therapist_id: t.therapist_id, therapist_name: th?.name ?? '—', count: 0, total_cents: 0, tips: [] };
    g.count += 1;
    g.total_cents += t.amount_cents;
    g.tips.push({ id: t.id, service_date: ord.service_date, order_no: ord.order_no, amount_cents: t.amount_cents });
    groups.set(t.therapist_id, g);
  }
  for (const g of groups.values()) g.tips.sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
  return [...groups.values()].sort((a, b) => b.total_cents - a.total_cents);
}

const settleSchema = z.object({
  branch_id: z.string().uuid(),
  tip_ids: z.array(z.string().uuid()).min(1),
});

/** Settle the selected open tips into one settlement (closed; ERP/AP posting deferred). */
export async function settleTips(input: unknown): Promise<ActionResult<{ id: string; count: number }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { branch_id, tip_ids } = parsed.data;
  if (!(await canAccessBranch(branch_id))) return { ok: false, error: 'No access to this branch' };
  try { await assertNoBlockedClose(branch_id); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const supabase = await createAuditedClient();
  const { data: rows } = await supabase
    .from('tips')
    .select('id, amount_cents, status, settlement_id, therapist:employees!tips_therapist_id_fkey ( id, name ), order:orders!tips_order_id_fkey ( service_date, branch_id )')
    .in('id', tip_ids);
  const valid = (rows ?? []).filter((t) => t.status === 'open' && !t.settlement_id && one(t.order)?.branch_id === branch_id);
  if (valid.length === 0) return { ok: false, error: 'No open tips to settle for the selection' };

  const dates = valid.map((t) => one(t.order)!.service_date).sort();
  const period_from = dates[0];
  const period_to = dates[dates.length - 1];
  const subtotal = valid.reduce((s, t) => s + t.amount_cents, 0);

  const { data: branch } = await supabase.from('branches').select('code').eq('id', branch_id).single();
  const ym = period_from.replace(/-/g, '').slice(0, 6);
  const prefix = `TS-${branch?.code ?? 'X'}-${ym}-`;
  const { data: last } = await supabase
    .from('tip_settlements').select('settlement_no').like('settlement_no', `${prefix}%`).order('settlement_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.settlement_no ? Number(last[0].settlement_no.slice(prefix.length)) : 0;
  const settlement_no = `${prefix}${String(seq + 1).padStart(2, '0')}`;

  const { data: settlement, error } = await supabase
    .from('tip_settlements')
    .insert({ settlement_no, branch_id, period_from, period_to, subtotal_cents: subtotal, status: 'closed', posted_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error || !settlement) return { ok: false, error: error?.message ?? 'Could not create settlement' };

  const ids = valid.map((t) => t.id);
  const { error: te } = await supabase.from('tips').update({ settlement_id: settlement.id, status: 'closed' }).in('id', ids);
  if (te) return { ok: false, error: te.message };

  // Render the per-therapist detail PDF and stash it in our private bucket — we
  // keep a copy regardless of ERP. The same buffer is attached to the AP Bill
  // on a successful post (best effort).
  const pdf = await renderTipPdf(settlement.id);
  let pdfPath: string | null = null;
  if (pdf) {
    pdfPath = `${settlement.id}.pdf`;
    const up = await supabase.storage.from('tip-pdfs').upload(pdfPath, pdf.buffer, { contentType: 'application/pdf', upsert: true });
    if (up.error) { console.error('[tip-pdf] upload failed:', up.error.message); pdfPath = null; }
    else {
      await (supabase.from('tip_settlements') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ pdf_file_path: pdfPath })
        .eq('id', settlement.id);
    }
  }

  // AP Bill: DR 20500 Tips Payable (per therapist) / CR 20100 AP (Acumatica
  // auto). The helper queries tips + therapists, builds lines, posts and
  // attaches the PDF — same path as Retry, so they can't drift.
  await postTipSettlementToErp(settlement.id);

  revalidatePath('/reconciliation/tips');
  return { ok: true, data: { id: settlement.id, count: valid.length } };
}

/** Re-attempt the AP Bill push for a settlement whose previous post failed.
 *  Manager-gated; refuses if already posted. Re-uses the shared helper, so the
 *  retry path runs exactly the same compose-and-post (lines + PDF attach). */
export async function retryTipPosting(settlementId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: s } = await supabase
    .from('tip_settlements')
    .select('branch_id')
    .eq('id', settlementId)
    .maybeSingle();
  if (!s) return { ok: false, error: 'Settlement not found' };
  if (!s.branch_id || !(await canAccessBranch(s.branch_id))) return { ok: false, error: 'No access to this branch' };

  // posting_status isn't in generated types yet — cast read.
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { posting_status: string | null } | null }> } };
    };
  };
  const pr = await sb.from('tip_settlements').select('posting_status').eq('id', settlementId).maybeSingle();
  if (pr.data?.posting_status === 'posted') return { ok: false, error: 'Already posted to ERP' };

  const r = await postTipSettlementToErp(settlementId);
  revalidatePath('/reconciliation/tips');
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

export async function voidTipSettlement(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  // Release the tips back to open so they can be re-settled.
  await supabase.from('tips').update({ settlement_id: null, status: 'open' }).eq('settlement_id', id);
  const { error } = await supabase.from('tip_settlements').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/tips');
  return { ok: true };
}
