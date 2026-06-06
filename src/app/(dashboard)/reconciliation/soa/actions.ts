'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch, getAllowedBranchIds } from '@/lib/branch-access';
import { assertNoBlockedClose } from '@/lib/business-day';
import { getCurrentOpenShift } from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

// ─────────────────────────────────────────────────────────────────────────────
// SOA is now built on folio_lines, not orders. Accounts receivable is an explicit
// ar-method folio line (掛帳): kind=payment (+) / refund (−), carrying a Bill to
// (billing_destination_id) and a guest. SOA "prep" groups the unbilled AR lines
// (soa_session_id IS NULL) for one billing destination × branch into a revenue_soa
// session. Settling opens ONE session-scoped folio settle line (order_id NULL),
// and every AR line in the session points back to it via settled_by_folio_line_id.
// Voiding a settle reverses that. There is no per-settle ERP push anymore — the
// folio ledger is the single base, and ERP is derived later from Sales Remittance.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function phtToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// ── Shared shapes (unchanged — the UI keys off these) ───────────────────────
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
  key: string; // `${billing_id}:${branch_id}` — one statement per billing × branch
  billing_id: string;
  branch_id: string;
  branch_code: string;
  code: string;
  name: string;
  settlement_type: string;
  bookings: number;
  total_cents: number;
  orders: SoaOrderLine[];
}

// The order graph hanging off an AR folio line, as selected for SOA detail.
interface RawSoaOrder {
  id: string;
  order_no: string;
  service_date: string;
  branch_id: string | null;
  branch: { code: string; name: string } | { code: string; name: string }[] | null;
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

// One AR folio line joined to its order + bill_to, as returned by the loader.
interface ArFolioRow {
  id: string;
  amount_cents: number;
  kind: string;
  order_id: string | null;
  billing_destination_id: string | null;
  order: RawSoaOrder | RawSoaOrder[] | null;
  billing: { id: string; code: string; name: string; settlement_type: string } | { id: string; code: string; name: string; settlement_type: string }[] | null;
}

// payment = +, refund = − (a refund reduces what the hotel owes).
const signed = (kind: string, cents: number): number => (kind === 'refund' ? -cents : cents);

// Build an order's SOA detail line from its graph. Mirrors the old order-base
// renderer (drop cancelled + zero-list placeholders), but the order total is the
// AR net we pass in, not the order's own total.
function toSoaOrderLine(o: RawSoaOrder, netCents: number): SoaOrderLine {
  const name = new Map((o.order_customers ?? []).map((c) => [c.id, c.customer_name]));
  const seq = new Map((o.order_customers ?? []).map((c) => [c.id, c.seq_no]));
  const lines: (SoaItemLine & { _seq: number })[] = (o.order_items ?? [])
    .filter((it) => it.status !== 'cancelled' && (it.list_price_cents ?? 0) > 0)
    .map((it) => ({
      guest: name.get(it.order_customer_id ?? '') ?? 'Guest',
      _seq: seq.get(it.order_customer_id ?? '') ?? 99,
      service: one(it.service)?.name ?? 'Service',
      duration_minutes: it.duration_minutes,
      gross_cents: it.list_price_cents ?? 0,
      discount_cents: it.discount_amount_cents ?? 0,
      net_cents: it.final_amount_cents ?? 0,
    }))
    .sort((a, b) => a._seq - b._seq);
  return {
    id: o.id,
    order_no: o.order_no,
    service_date: o.service_date,
    total_cents: netCents,
    lines: lines.map(({ _seq, ...rest }) => rest),
  };
}

const AR_FOLIO_SELECT = `
  id, amount_cents, kind, order_id, billing_destination_id,
  order:orders!folio_lines_order_id_fkey (
    id, order_no, service_date, branch_id,
    branch:branches ( code, name ),
    order_customers ( id, customer_name, seq_no ),
    order_items ( order_customer_id, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, status, service:service_items ( name ) )
  ),
  billing:billing_destinations!folio_lines_billing_destination_id_fkey ( id, code, name, settlement_type )
`;

// Resolve the ar payment_method id (every AR line carries it).
async function arMethodId(supabase: Awaited<ReturnType<typeof createAuditedClient>>): Promise<string | null> {
  const { data } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  return data?.id ?? null;
}

// Fetch the AR folio lines that are not yet on a SOA (unbilled), optionally
// scoped to one billing destination + branch. The caller filters by service date.
async function loadUnbilledArLines(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  scope?: { billingToId: string; branchId: string },
): Promise<ArFolioRow[]> {
  const arId = await arMethodId(supabase);
  if (!arId) return [];
  let q = supabase
    .from('folio_lines')
    .select(AR_FOLIO_SELECT)
    .eq('payment_method_id', arId)
    .in('kind', ['payment', 'refund'])
    .is('soa_session_id', null)
    .not('order_id', 'is', null);
  if (scope) q = q.eq('billing_destination_id', scope.billingToId);
  const { data } = await q;
  let rows = (data ?? []) as unknown as ArFolioRow[];
  if (scope) rows = rows.filter((r) => (one(r.order)?.branch_id ?? null) === scope.branchId);
  return rows;
}

/**
 * Every AR billing destination with unbilled AR folio lines whose order falls in
 * range — grouped by billing × branch, with per-order detail. Drives the
 * "Generate SOA" workspace.
 */
export async function loadSoaWorkspace(from: string, to: string): Promise<SoaGroup[]> {
  const supabase = await createAuditedClient();
  const allowed = await getAllowedBranchIds();
  const rows = await loadUnbilledArLines(supabase);

  // order_id → { order graph, net AR cents }, restricted to the date window +
  // allowed branches.
  const byOrder = new Map<string, { order: RawSoaOrder; net: number; billing: { id: string; code: string; name: string; settlement_type: string } }>();
  for (const r of rows) {
    const order = one(r.order);
    const billing = one(r.billing);
    if (!order || !billing || !order.branch_id) continue;
    if (order.service_date < from || order.service_date > to) continue;
    if (!allowed.has(order.branch_id)) continue;
    const cur = byOrder.get(order.id) ?? { order, net: 0, billing };
    cur.net += signed(r.kind, r.amount_cents);
    byOrder.set(order.id, cur);
  }

  // Group order → (billing × branch). A statement never mixes branches.
  const groups = new Map<string, SoaGroup>();
  for (const { order, net, billing } of byOrder.values()) {
    if (net === 0) continue;
    const br = one(order.branch);
    const key = `${billing.id}:${order.branch_id}`;
    const g = groups.get(key) ?? {
      key, billing_id: billing.id, branch_id: order.branch_id!, branch_code: br?.code ?? '—',
      code: billing.code, name: billing.name, settlement_type: billing.settlement_type, bookings: 0, total_cents: 0, orders: [],
    };
    g.bookings += 1;
    g.total_cents += net;
    g.orders.push(toSoaOrderLine(order, net));
    groups.set(key, g);
  }
  for (const g of groups.values()) g.orders.sort((a, b) => a.service_date.localeCompare(b.service_date) || a.order_no.localeCompare(b.order_no));
  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code) || a.branch_code.localeCompare(b.branch_code));
}

const createSchema = z.object({
  billing_to_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  period_from: z.string().min(1),
  period_to: z.string().min(1),
});

/** Generate one SOA per (billing × branch) group: stamp the in-range unbilled AR
 *  lines with the new session id. */
export async function generateSOA(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { billing_to_id, branch_id, period_from, period_to } = parsed.data;
  if (period_to < period_from) return { ok: false, error: 'End date must be on/after start date' };

  const supabase = await createAuditedClient();
  const { data: billing } = await supabase
    .from('billing_destinations')
    .select('code, settlement_type, credit_terms_days')
    .eq('id', billing_to_id)
    .single();
  if (!billing) return { ok: false, error: 'Billing destination not found' };
  const { data: branch } = await supabase.from('branches').select('code').eq('id', branch_id).single();
  if (!branch) return { ok: false, error: 'Branch not found' };
  if (!(await canAccessBranch(branch_id))) return { ok: false, error: 'No access to this branch' };

  // Unbilled AR lines for this billing × branch, in range.
  const rows = await loadUnbilledArLines(supabase, { billingToId: billing_to_id, branchId: branch_id });
  const lineIds: string[] = [];
  let subtotal = 0;
  for (const r of rows) {
    const order = one(r.order);
    if (!order || order.service_date < period_from || order.service_date > period_to) continue;
    lineIds.push(r.id);
    subtotal += signed(r.kind, r.amount_cents);
  }
  if (lineIds.length === 0) return { ok: false, error: 'No un-stated AR for this billing/branch/period' };

  const ym = period_from.replace(/-/g, '').slice(0, 6);
  const prefix = `SOA-${ym}-${billing.code}-${branch.code}-`;
  const { data: last } = await supabase
    .from('revenue_soa').select('soa_no').like('soa_no', `${prefix}%`).order('soa_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.soa_no ? Number(last[0].soa_no.slice(prefix.length)) : 0;
  const soa_no = `${prefix}${String(seq + 1).padStart(3, '0')}`;

  const today = phtToday();
  const dueDate = billing.settlement_type === 'third_party' && (billing.credit_terms_days ?? 0) > 0
    ? new Date(Date.now() + (billing.credit_terms_days ?? 0) * 86400000).toISOString().slice(0, 10)
    : null;

  const { data: soa, error } = await supabase
    .from('revenue_soa')
    .insert({
      soa_no, billing_to_id, branch_id, period_from, period_to,
      settlement_type: billing.settlement_type,
      subtotal_cents: subtotal, total_cents: subtotal, paid_cents: 0, outstanding_cents: subtotal,
      status: 'issued', issued_date: today, due_date: dueDate,
    })
    .select('id')
    .single();
  if (error || !soa) return { ok: false, error: error?.message ?? 'Could not create SOA' };

  const { error: le } = await supabase.from('folio_lines').update({ soa_session_id: soa.id }).in('id', lineIds);
  if (le) return { ok: false, error: le.message };

  revalidatePath('/reconciliation/soa');
  return { ok: true, data: { id: soa.id } };
}

/** Generate one SOA per selected (billing × branch) group over the same period. */
export async function generateSOAGroups(groups: { billing_to_id: string; branch_id: string }[], from: string, to: string): Promise<ActionResult<{ created: number }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  if (!groups.length) return { ok: false, error: 'Select at least one statement to generate' };
  let created = 0;
  const errors: string[] = [];
  for (const g of groups) {
    const r = await generateSOA({ billing_to_id: g.billing_to_id, branch_id: g.branch_id, period_from: from, period_to: to });
    if (r.ok) created += 1;
    else errors.push(r.error);
  }
  if (created === 0) return { ok: false, error: errors[0] ?? 'Nothing to generate' };
  revalidatePath('/reconciliation/soa');
  return { ok: true, data: { created } };
}

export interface SoaHistoryRow {
  id: string;
  soa_no: string;
  status: string;
  settlement_type: string | null;
  period_from: string;
  period_to: string;
  total_cents: number;
  outstanding_cents: number;
  billing_code: string | null;
  billing_name: string | null;
  // Kept for shape compatibility with the History UI; folio-base settle no longer
  // pushes a GL voucher, so these stay null (ERP is derived from Sales Remittance).
  gl_batch_nbr: string | null;
  posting_status: string | null;
  posting_error: string | null;
  detail: SoaOrderLine[];
}

/** All statements, newest first, each with its folio-derived order detail. */
export async function loadSoaHistory(): Promise<SoaHistoryRow[]> {
  const supabase = await createAuditedClient();
  const { data: soas } = await supabase
    .from('revenue_soa')
    .select('id, soa_no, status, settlement_type, period_from, period_to, total_cents, outstanding_cents, billing:billing_destinations!revenue_soa_billing_to_id_fkey ( code, name )')
    .order('created_at', { ascending: false });
  const soaList = soas ?? [];
  if (soaList.length === 0) return [];

  // Member AR lines for these sessions (order_id not null = the receivable lines;
  // settle lines have order_id null and are excluded from the order detail).
  const ids = soaList.map((s) => s.id);
  const { data: lines } = await supabase
    .from('folio_lines')
    .select(`id, amount_cents, kind, soa_session_id, order_id, ${AR_FOLIO_SELECT}`)
    .in('soa_session_id', ids)
    .not('order_id', 'is', null);

  // soa_session_id → (order_id → { order, net })
  const bySession = new Map<string, Map<string, { order: RawSoaOrder; net: number }>>();
  for (const raw of (lines ?? []) as unknown as (ArFolioRow & { soa_session_id: string })[]) {
    const order = one(raw.order);
    if (!order) continue;
    const m = bySession.get(raw.soa_session_id) ?? new Map();
    const cur = m.get(order.id) ?? { order, net: 0 };
    cur.net += signed(raw.kind, raw.amount_cents);
    m.set(order.id, cur);
    bySession.set(raw.soa_session_id, m);
  }

  return soaList.map((s) => {
    const b = one(s.billing as { code: string | null; name: string | null } | { code: string | null; name: string | null }[] | null);
    const detail = [...(bySession.get(s.id)?.values() ?? [])]
      .map(({ order, net }) => toSoaOrderLine(order, net))
      .sort((a, c) => a.service_date.localeCompare(c.service_date) || a.order_no.localeCompare(c.order_no));
    return {
      id: s.id, soa_no: s.soa_no, status: s.status, settlement_type: s.settlement_type,
      period_from: s.period_from, period_to: s.period_to, total_cents: s.total_cents,
      outstanding_cents: s.outstanding_cents ?? s.total_cents,
      billing_code: b?.code ?? null, billing_name: b?.name ?? null,
      gl_batch_nbr: null, posting_status: null, posting_error: null,
      detail,
    };
  });
}

// ─────────────────────────── AR Balance ───────────────────────────
export interface ArSoa {
  id: string;
  soa_no: string;
  settlement_type: string | null;
  period_from: string;
  period_to: string;
  total_cents: number;
  outstanding_cents: number;
  due_date: string | null;
  status: string;
  days_overdue: number;
}
export interface ArDebtor {
  billing_id: string;
  code: string;
  name: string;
  settlement_type: string;
  unbilled_cents: number;
  outstanding_cents: number;
  current_cents: number;
  overdue_cents: number;
  total_cents: number;
  unbilled_count: number;
  soas: ArSoa[];
}
export interface ArBalance {
  today: string;
  debtors: ArDebtor[];
  total_cents: number;
  current_cents: number;
  overdue_cents: number;
}

/** Branch-scoped AR balance grouped by billing destination: unbilled AR folio
 *  lines + open SOA outstanding. */
export async function loadArBalance(): Promise<ArBalance> {
  const supabase = await createAuditedClient();
  const allowed = [...(await getAllowedBranchIds())];
  const today = phtToday();
  const empty: ArBalance = { today, debtors: [], total_cents: 0, current_cents: 0, overdue_cents: 0 };
  if (allowed.length === 0) return empty;

  const { data: bills } = await supabase
    .from('billing_destinations')
    .select('id, code, name, settlement_type')
    .eq('active', true);
  const billInfo = new Map((bills ?? []).map((b) => [b.id, b]));

  const [{ data: soas }, rows] = await Promise.all([
    supabase
      .from('revenue_soa')
      .select('id, soa_no, billing_to_id, settlement_type, period_from, period_to, total_cents, outstanding_cents, due_date, status, billing:billing_destinations!revenue_soa_billing_to_id_fkey ( code, name, settlement_type )')
      .in('status', ['issued', 'partial_paid'])
      .in('branch_id', allowed),
    loadUnbilledArLines(supabase),
  ]);

  const debtors = new Map<string, ArDebtor>();
  const ensure = (billingId: string, code: string, name: string, settlement: string): ArDebtor => {
    let d = debtors.get(billingId);
    if (!d) {
      d = { billing_id: billingId, code, name, settlement_type: settlement, unbilled_cents: 0, outstanding_cents: 0, current_cents: 0, overdue_cents: 0, total_cents: 0, unbilled_count: 0, soas: [] };
      debtors.set(billingId, d);
    }
    return d;
  };

  // Open SOAs → outstanding, split current / overdue by due date.
  for (const s of soas ?? []) {
    const b = one(s.billing);
    const d = ensure(s.billing_to_id, b?.code ?? '—', b?.name ?? '', b?.settlement_type ?? s.settlement_type ?? 'third_party');
    const outstanding = s.outstanding_cents ?? s.total_cents;
    const overdue = s.due_date != null && s.due_date < today && outstanding > 0;
    const daysOverdue = overdue ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${s.due_date}T00:00:00Z`)) / 86400000) : 0;
    d.outstanding_cents += outstanding;
    if (overdue) d.overdue_cents += outstanding; else d.current_cents += outstanding;
    d.soas.push({ id: s.id, soa_no: s.soa_no, settlement_type: s.settlement_type, period_from: s.period_from, period_to: s.period_to, total_cents: s.total_cents, outstanding_cents: outstanding, due_date: s.due_date, status: s.status, days_overdue: daysOverdue });
  }

  // Unbilled AR folio lines (net) → current, grouped by bill_to (allowed branches).
  const unbilledByDest = new Map<string, { net: number; orders: Set<string> }>();
  for (const r of rows) {
    const order = one(r.order);
    if (!order || !order.branch_id || !allowed.includes(order.branch_id) || !r.billing_destination_id) continue;
    const cur = unbilledByDest.get(r.billing_destination_id) ?? { net: 0, orders: new Set() };
    cur.net += signed(r.kind, r.amount_cents);
    if (order.id) cur.orders.add(order.id);
    unbilledByDest.set(r.billing_destination_id, cur);
  }
  for (const [destId, { net, orders }] of unbilledByDest) {
    if (net === 0) continue;
    const info = billInfo.get(destId);
    const d = ensure(destId, info?.code ?? '—', info?.name ?? '', info?.settlement_type ?? 'third_party');
    d.unbilled_cents += net;
    d.current_cents += net;
    d.unbilled_count += orders.size;
  }

  const list = [...debtors.values()]
    .map((d) => {
      d.total_cents = d.unbilled_cents + d.outstanding_cents;
      d.soas.sort((a, c) => (c.days_overdue - a.days_overdue) || a.soa_no.localeCompare(c.soa_no));
      return d;
    })
    .filter((d) => d.total_cents !== 0)
    .sort((a, c) => (c.overdue_cents - a.overdue_cents) || (c.total_cents - a.total_cents) || a.code.localeCompare(c.code));

  return {
    today,
    debtors: list,
    total_cents: list.reduce((s, d) => s + d.total_cents, 0),
    current_cents: list.reduce((s, d) => s + d.current_cents, 0),
    overdue_cents: list.reduce((s, d) => s + d.overdue_cents, 0),
  };
}

// ─────────────────────────── Settle / Unsettle / Void ───────────────────────
const settleSchema = z.object({
  soa_id: z.string().uuid(),
  payment_method: z.enum(['cash', 'bank']),
  proof_file_path: z.string().max(400).optional().nullable(),
});

/**
 * Settle a statement with ONE session-scoped folio settle line (kind=payment,
 * order_id NULL). It carries the destination's bound transaction code, posts to
 * the branch's open shift (so it lands in Sales Remittance), and every AR line in
 * the session points back to it via settled_by_folio_line_id. Both intercompany
 * and third-party use this path; method is cash/bank for now.
 */
export async function settleSOA(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { soa_id, payment_method, proof_file_path } = parsed.data;
  const supabase = await createAuditedClient();

  const { data: soa } = await supabase
    .from('revenue_soa')
    .select('soa_no, status, total_cents, paid_cents, outstanding_cents, branch_id, billing_to_id, billing:billing_destinations!revenue_soa_billing_to_id_fkey ( transaction_code_id )')
    .eq('id', soa_id)
    .single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (!['issued', 'partial_paid'].includes(soa.status)) return { ok: false, error: 'Only an open statement can be settled' };
  try { await assertNoBlockedClose(soa.branch_id); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const txCodeId = one(soa.billing as { transaction_code_id: string | null } | { transaction_code_id: string | null }[] | null)?.transaction_code_id ?? null;
  if (!txCodeId) return { ok: false, error: 'This billing destination has no transaction code bound — set one in Settings → Billing Destinations first.' };

  const { data: pm } = await supabase.from('payment_methods').select('id').eq('code', payment_method).maybeSingle();
  if (!pm) return { ok: false, error: `No payment method "${payment_method}"` };

  const openShift = await getCurrentOpenShift(soa.branch_id);
  if (!openShift) return { ok: false, error: 'No cash shift is open for this branch — open one on the Sales Remittance page before settling.' };

  const amount = (soa.outstanding_cents ?? soa.total_cents - soa.paid_cents);
  const { data: settleLine, error: se } = await supabase
    .from('folio_lines')
    .insert({
      order_id: null,
      shift_id: openShift.id,
      kind: 'payment',
      amount_cents: amount,
      posted_by: session!.staffUserId,
      payment_method_id: pm.id,
      branch_id: soa.branch_id,
      billing_destination_id: soa.billing_to_id,
      soa_session_id: soa_id,
      transaction_code_id: txCodeId,
      proof_file_path: proof_file_path || null,
    })
    .select('id')
    .single();
  if (se || !settleLine) return { ok: false, error: se?.message ?? 'Could not post settle line' };

  // Point every receivable line in the session back at the settle line.
  const { error: ue } = await supabase
    .from('folio_lines')
    .update({ settled_by_folio_line_id: settleLine.id })
    .eq('soa_session_id', soa_id)
    .not('order_id', 'is', null);
  if (ue) return { ok: false, error: ue.message };

  const { error: soe } = await supabase
    .from('revenue_soa')
    .update({ status: 'settled', paid_cents: soa.total_cents, outstanding_cents: 0 })
    .eq('id', soa_id);
  if (soe) return { ok: false, error: soe.message };

  revalidatePath('/reconciliation/soa');
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}

/**
 * Reverse a settle: post a NEGATIVE settle folio line (kind=refund, same method /
 * branch / code), clear settled_by on every session line, and reopen the SOA.
 */
export async function unsettleSOA(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();

  const { data: soa } = await supabase
    .from('revenue_soa')
    .select('status, total_cents, branch_id, billing_to_id')
    .eq('id', id)
    .single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (soa.status !== 'settled') return { ok: false, error: 'Only a settled statement can be unsettled' };
  try { await assertNoBlockedClose(soa.branch_id); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // The positive settle line that settled this session.
  const { data: settleLine } = await supabase
    .from('folio_lines')
    .select('id, amount_cents, payment_method_id, transaction_code_id')
    .eq('soa_session_id', id)
    .is('order_id', null)
    .eq('kind', 'payment')
    .order('posted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!settleLine) return { ok: false, error: 'No settle line found for this statement' };
  if (!settleLine.transaction_code_id) return { ok: false, error: 'Settle line is missing its transaction code' };

  const openShift = await getCurrentOpenShift(soa.branch_id);
  if (!openShift) return { ok: false, error: 'No cash shift is open for this branch — open one before reversing the settle.' };

  const { error: re } = await supabase.from('folio_lines').insert({
    order_id: null,
    shift_id: openShift.id,
    kind: 'refund',
    amount_cents: settleLine.amount_cents,
    posted_by: session!.staffUserId,
    payment_method_id: settleLine.payment_method_id,
    branch_id: soa.branch_id,
    billing_destination_id: soa.billing_to_id,
    soa_session_id: id,
    transaction_code_id: settleLine.transaction_code_id,
  });
  if (re) return { ok: false, error: re.message };

  // Clear the per-line settle reference.
  const { error: ce } = await supabase
    .from('folio_lines')
    .update({ settled_by_folio_line_id: null })
    .eq('soa_session_id', id)
    .not('order_id', 'is', null);
  if (ce) return { ok: false, error: ce.message };

  const { error: soe } = await supabase
    .from('revenue_soa')
    .update({ status: 'issued', paid_cents: 0, outstanding_cents: soa.total_cents })
    .eq('id', id);
  if (soe) return { ok: false, error: soe.message };

  revalidatePath('/reconciliation/soa');
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation');
  return { ok: true };
}

/** Void an issued (unsettled) statement: release its AR lines back to the pool. */
export async function voidSOA(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: soa } = await supabase.from('revenue_soa').select('status, branch_id').eq('id', id).single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (soa.status !== 'issued') {
    return { ok: false, error: 'Only an issued statement can be voided; unsettle a settled one first.' };
  }
  // Release the AR lines so they can be re-stated.
  const { error: re } = await supabase.from('folio_lines').update({ soa_session_id: null }).eq('soa_session_id', id);
  if (re) return { ok: false, error: re.message };
  const { error } = await supabase.from('revenue_soa').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/soa');
  return { ok: true };
}

// ─────────────────────────── Settle ledger + proof ──────────────────────────
export interface SoaPaymentRow {
  id: string;
  amount_cents: number;
  kind: string; // payment (settle) | refund (reversal)
  paid_at: string;
  payment_method: string | null;
  reference_no: string | null;
  proof_file_path: string | null;
}

/** The settle / reversal folio lines posted against a statement, newest first. */
export async function loadSoaPayments(soa_id: string): Promise<SoaPaymentRow[]> {
  const supabase = await createAuditedClient();
  const { data: soa } = await supabase.from('revenue_soa').select('branch_id').eq('id', soa_id).maybeSingle();
  if (!soa?.branch_id || !(await canAccessBranch(soa.branch_id))) return [];
  const { data } = await supabase
    .from('folio_lines')
    .select('id, amount_cents, kind, posted_at, payment_ref, proof_file_path, method:payment_methods ( code )')
    .eq('soa_session_id', soa_id)
    .is('order_id', null)
    .order('posted_at', { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    amount_cents: r.amount_cents,
    kind: r.kind,
    paid_at: r.posted_at,
    payment_method: one(r.method as { code: string } | { code: string }[] | null)?.code ?? null,
    reference_no: r.payment_ref,
    proof_file_path: r.proof_file_path,
  }));
}

/** Upload an AR settle proof (cash photo / remittance slip) to the private
 *  ar-proofs bucket. Returns the storage path to stamp on the settle line. */
export async function uploadArProof(formData: FormData): Promise<ActionResult<{ path: string }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const file = formData.get('file');
  const soaId = formData.get('soa_id');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file to upload' };
  if (typeof soaId !== 'string') return { ok: false, error: 'Missing statement reference' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'File is too large (max 10 MB)' };
  const supabase = await createAuditedClient();
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${soaId}/${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from('ar-proofs')
    .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { path } };
}

/** Short-lived signed URL to view a stored AR proof (bucket is private). */
export async function getArProofUrl(path: string): Promise<ActionResult<{ url: string }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data, error } = await supabase.storage.from('ar-proofs').createSignedUrl(path, 600);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not generate link' };
  return { ok: true, data: { url: data.signedUrl } };
}
