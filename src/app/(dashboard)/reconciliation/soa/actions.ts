'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient, createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch, getAllowedBranchIds } from '@/lib/branch-access';
import { assertNoBlockedClose } from '@/lib/business-day';
import { postToErp, acumaticaConfigured, type PostToErpResult } from '@/lib/erp-posting';
import { pushGLEntry, attachFileToJournal, type GLLine } from '@/lib/acumatica';
import { readAcuSessionCookie } from '@/lib/session';
import { renderSoaPdf } from '@/lib/soa-pdf';

// Render the SOA voucher PDF and return it as a fresh ArrayBuffer payload for
// postToErp's renderedAttachment slot. Best-effort: a failed render returns
// undefined so the post still runs (and just doesn't get the PDF attached).
// Buffer is copied into a new ArrayBuffer because Node Buffer's underlying
// buffer may be SharedArrayBuffer, which attachFileToJournal doesn't accept.
async function buildSoaAttachment(soaId: string): Promise<{ filename: string; buffer: ArrayBuffer; mimeType: string } | undefined> {
  try {
    const pdf = await renderSoaPdf(soaId);
    if (!pdf) return undefined;
    const ab = new ArrayBuffer(pdf.buffer.byteLength);
    new Uint8Array(ab).set(pdf.buffer);
    return { filename: pdf.filename, buffer: ab, mimeType: 'application/pdf' };
  } catch (e) {
    console.error('[SOA PDF render] failed:', e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

// AR control account — constant for the whole SPA entity (CR side of a settle).
const AR_ACCOUNT = '10200';
const AR_SUBACCOUNT = '000-000-000'; // dashes stripped before posting

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface SoaCandidate {
  id: string;
  order_no: string;
  service_date: string;
  total_cents: number;
}

/** Closed AR orders for a billing destination AT ONE BRANCH in range, not yet on any SOA. */
export async function loadSoaCandidates(billingToId: string, branchId: string, from: string, to: string): Promise<SoaCandidate[]> {
  const supabase = await createAuditedClient();
  const [{ data: orders }, { data: taken }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_no, service_date, total_cents, status')
      .eq('billing_to_id', billingToId)
      .eq('branch_id', branchId)
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
// We drop cancelled lines AND zero-list-price placeholders: a real service
// always carries a list price (DIS-90 discounts net to 0 but list stays
// positive), so a `list_price_cents <= 0` row is a junk / orphan item that
// shouldn't appear on the statement.
function toSoaOrderLine(o: RawSoaOrder): SoaOrderLine {
  const name = new Map((o.order_customers ?? []).map((c) => [c.id, c.customer_name]));
  const seq = new Map((o.order_customers ?? []).map((c) => [c.id, c.seq_no]));
  const lines: SoaItemLine[] = (o.order_items ?? [])
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
  outstanding_cents: number;
  billing_code: string | null;
  billing_name: string | null;
  // ERP voucher fields — populated once the settle / payment journal is posted.
  // gl_batch_nbr is the Acumatica F-number shown next to the SOA in History so
  // the desk can cross-reference Acumatica without re-opening the SOA detail.
  gl_batch_nbr: string | null;
  posting_status: string | null;
  posting_error: string | null;
  // The orders stated on this SOA (for the expandable History detail). Empty for
  // voided statements — voiding releases the order links.
  detail: SoaOrderLine[];
}

/** All statements, newest first, each with its stated-orders detail. */
export async function loadSoaHistory(): Promise<SoaHistoryRow[]> {
  const supabase = await createAuditedClient();
  // gl_batch_nbr / posting_status / posting_error aren't in the generated DB
  // types yet — read through an untyped surface and rely on the explicit
  // mapping below to keep the public SoaHistoryRow strict.
  const { data } = await (supabase.from('revenue_soa') as unknown as {
    select: (c: string) => { order: (k: string, o: { ascending: boolean }) => Promise<{ data: Array<Record<string, unknown>> | null }> };
  })
    .select(`
      id, soa_no, status, settlement_type, period_from, period_to, total_cents, outstanding_cents,
      gl_batch_nbr, posting_status, posting_error,
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
  return (data ?? []).map((raw) => {
    const s = raw as {
      id: string; soa_no: string; status: string; settlement_type: string | null;
      period_from: string; period_to: string; total_cents: number; outstanding_cents: number | null;
      gl_batch_nbr: string | null; posting_status: string | null; posting_error: string | null;
      billing: { code: string | null; name: string | null } | { code: string | null; name: string | null }[] | null;
      revenue_soa_orders: { order: RawSoaOrder | RawSoaOrder[] | null }[] | null;
    };
    const b = one(s.billing);
    const detail = (s.revenue_soa_orders ?? [])
      .map((link) => one(link.order) as RawSoaOrder | null)
      .filter((o): o is RawSoaOrder => Boolean(o))
      .map(toSoaOrderLine)
      .sort((a, c) => a.service_date.localeCompare(c.service_date) || a.order_no.localeCompare(c.order_no));
    return {
      id: s.id, soa_no: s.soa_no, status: s.status, settlement_type: s.settlement_type,
      period_from: s.period_from, period_to: s.period_to, total_cents: s.total_cents,
      outstanding_cents: s.outstanding_cents ?? s.total_cents,
      billing_code: b?.code ?? null, billing_name: b?.name ?? null,
      gl_batch_nbr: s.gl_batch_nbr,
      posting_status: s.posting_status,
      posting_error: s.posting_error,
      detail,
    };
  });
}

// ─────────────────────────── AR Balance ───────────────────────────
// Receivables ledger view: how much is still owed, by whom, and how overdue.
// It stores nothing new — it sums open SOA outstanding + unbilled closed AR.

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
  days_overdue: number; // >0 only for past-due third-party statements
}

export interface ArDebtor {
  billing_id: string;
  code: string;
  name: string;
  settlement_type: string; // intercompany | third_party
  unbilled_cents: number; // closed AR not yet stated on any SOA
  outstanding_cents: number; // billed but not fully paid (Σ open-SOA outstanding)
  current_cents: number; // not past due (unbilled + not-overdue outstanding)
  overdue_cents: number; // past-due outstanding
  total_cents: number; // unbilled + outstanding
  unbilled_count: number;
  soas: ArSoa[];
}

export interface ArBalance {
  today: string; // PHT yyyy-mm-dd — the as-of date for the overdue split
  debtors: ArDebtor[];
  total_cents: number;
  current_cents: number;
  overdue_cents: number;
}

function phtToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Branch-scoped accounts-receivable balance, grouped by billing destination. */
export async function loadArBalance(): Promise<ArBalance> {
  const supabase = await createAuditedClient();
  const allowed = [...(await getAllowedBranchIds())];
  const today = phtToday();
  const empty: ArBalance = { today, debtors: [], total_cents: 0, current_cents: 0, overdue_cents: 0 };
  if (allowed.length === 0) return empty;

  // AR billing destinations (those that bill on AR terms).
  const { data: arMethod } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arId = arMethod?.id ?? null;
  const { data: bills } = await supabase
    .from('billing_destinations')
    .select('id, code, name, settlement_type, default_payment_method_id')
    .eq('active', true);
  const billInfo = new Map((bills ?? []).map((b) => [b.id, b]));
  const arBillIds = (bills ?? []).filter((b) => arId && b.default_payment_method_id === arId).map((b) => b.id);

  // Open statements in the allowed branches, plus all un-stated closed AR orders.
  const [{ data: soas }, { data: orders }, { data: taken }] = await Promise.all([
    supabase
      .from('revenue_soa')
      .select('id, soa_no, billing_to_id, settlement_type, period_from, period_to, total_cents, outstanding_cents, due_date, status, billing:billing_destinations!revenue_soa_billing_to_id_fkey ( code, name, settlement_type )')
      .in('status', ['issued', 'partial_paid'])
      .in('branch_id', allowed),
    arBillIds.length
      ? supabase
          .from('orders')
          .select('id, billing_to_id, total_cents')
          .eq('status', 'closed')
          .is('deleted_at', null)
          .in('billing_to_id', arBillIds)
          .in('branch_id', allowed)
      : Promise.resolve({ data: [] as { id: string; billing_to_id: string | null; total_cents: number }[] }),
    supabase.from('revenue_soa_orders').select('order_id'),
  ]);
  const takenIds = new Set((taken ?? []).map((t) => t.order_id));

  const debtors = new Map<string, ArDebtor>();
  const ensure = (billingId: string, code: string, name: string, settlement: string): ArDebtor => {
    let d = debtors.get(billingId);
    if (!d) {
      d = {
        billing_id: billingId, code, name, settlement_type: settlement,
        unbilled_cents: 0, outstanding_cents: 0, current_cents: 0, overdue_cents: 0,
        total_cents: 0, unbilled_count: 0, soas: [],
      };
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
    if (overdue) d.overdue_cents += outstanding;
    else d.current_cents += outstanding;
    d.soas.push({
      id: s.id, soa_no: s.soa_no, settlement_type: s.settlement_type,
      period_from: s.period_from, period_to: s.period_to,
      total_cents: s.total_cents, outstanding_cents: outstanding,
      due_date: s.due_date, status: s.status, days_overdue: daysOverdue,
    });
  }

  // Unbilled closed AR orders → current (not yet billed, no due date).
  for (const o of orders ?? []) {
    if (!o.billing_to_id || takenIds.has(o.id)) continue;
    const info = billInfo.get(o.billing_to_id);
    const d = ensure(o.billing_to_id, info?.code ?? '—', info?.name ?? '', info?.settlement_type ?? 'third_party');
    d.unbilled_cents += o.total_cents;
    d.current_cents += o.total_cents;
    d.unbilled_count += 1;
  }

  const list = [...debtors.values()]
    .map((d) => {
      d.total_cents = d.unbilled_cents + d.outstanding_cents;
      d.soas.sort((a, c) => (c.days_overdue - a.days_overdue) || a.soa_no.localeCompare(c.soa_no));
      return d;
    })
    .filter((d) => d.total_cents > 0)
    .sort((a, c) => (c.overdue_cents - a.overdue_cents) || (c.total_cents - a.total_cents) || a.code.localeCompare(c.code));

  return {
    today,
    debtors: list,
    total_cents: list.reduce((s, d) => s + d.total_cents, 0),
    current_cents: list.reduce((s, d) => s + d.current_cents, 0),
    overdue_cents: list.reduce((s, d) => s + d.overdue_cents, 0),
  };
}

/**
 * Every AR billing destination with closed orders in range that aren't on any
 * SOA yet — grouped, with per-guest detail. Drives the "Generate SOA" workspace.
 */
export async function loadSoaWorkspace(from: string, to: string): Promise<SoaGroup[]> {
  const supabase = await createAuditedClient();
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
      .select('id, order_no, service_date, total_cents, billing_to_id, branch_id, branch:branches ( code, name ), order_customers ( id, customer_name, seq_no ), order_items ( order_customer_id, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, status, service:service_items ( name ) )')
      .in('billing_to_id', [...billMap.keys()])
      .eq('status', 'closed')
      .is('deleted_at', null)
      .gte('service_date', from)
      .lte('service_date', to)
      .order('service_date'),
    supabase.from('revenue_soa_orders').select('order_id'),
  ]);
  const takenIds = new Set((taken ?? []).map((t) => t.order_id));

  // One group (→ one statement) per billing × branch — a statement never mixes branches.
  const groups = new Map<string, SoaGroup>();
  for (const o of orders ?? []) {
    if (takenIds.has(o.id) || !o.billing_to_id || !o.branch_id) continue;
    const b = billMap.get(o.billing_to_id);
    if (!b) continue;
    const br = one(o.branch);
    const key = `${b.id}:${o.branch_id}`;
    const g = groups.get(key) ?? {
      key, billing_id: b.id, branch_id: o.branch_id, branch_code: br?.code ?? '—',
      code: b.code, name: b.name, settlement_type: b.settlement_type, bookings: 0, total_cents: 0, orders: [],
    };
    g.bookings += 1;
    g.total_cents += o.total_cents;
    g.orders.push(toSoaOrderLine(o as unknown as RawSoaOrder));
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code) || a.branch_code.localeCompare(b.branch_code));
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

const createSchema = z.object({
  billing_to_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  period_from: z.string().min(1),
  period_to: z.string().min(1),
});

// Add `days` to a yyyy-mm-dd string, returning yyyy-mm-dd. Used to compute the
// day-after-prior-coverage when auto-narrowing period_from on SOA generation.
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  // Auto-narrow period_from to the day after the most recent live SOA's
  // period_to for this billing destination, when its window overlaps the
  // requested range. The picker is a "max window I care about" — without
  // narrowing, a wide month pick (5/01–5/29) collides with the semi-monthly
  // SOA already covering the first half (5/01–5/15) and trips
  // no_soa_period_overlap. The orders are already de-duped by loadSoaCandidates
  // (anything on a live SOA is excluded), so narrowing only changes the
  // STORED period — the bills the new SOA captures are unaffected.
  const { data: prior } = await supabase
    .from('revenue_soa')
    .select('period_to, soa_no')
    .eq('billing_to_id', billing_to_id)
    .in('status', ['issued', 'partial_paid', 'settled'])
    .gte('period_to', period_from)
    .lte('period_from', period_to)
    .order('period_to', { ascending: false })
    .limit(1);
  const effectiveFrom = prior?.[0]?.period_to ? addDaysYmd(prior[0].period_to, 1) : period_from;
  if (effectiveFrom > period_to) {
    return { ok: false, error: `Already covered by ${prior![0]!.soa_no} (through ${prior![0]!.period_to}) — nothing new to bill` };
  }

  const candidates = await loadSoaCandidates(billing_to_id, branch_id, effectiveFrom, period_to);
  if (candidates.length === 0) return { ok: false, error: 'No un-SOA’d closed orders for this billing/branch/period' };
  const subtotal = candidates.reduce((s, c) => s + c.total_cents, 0);

  const ym = effectiveFrom.replace(/-/g, '').slice(0, 6);
  const prefix = `SOA-${ym}-${billing.code}-${branch.code}-`;
  const { data: last } = await supabase
    .from('revenue_soa').select('soa_no').like('soa_no', `${prefix}%`).order('soa_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.soa_no ? Number(last[0].soa_no.slice(prefix.length)) : 0;
  const soa_no = `${prefix}${String(seq + 1).padStart(3, '0')}`;

  // Generated statements are issued immediately (no separate Issue step). Stamp
  // the statement date now; third-party gets a due date from its credit terms.
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = billing.settlement_type === 'third_party' && (billing.credit_terms_days ?? 0) > 0
    ? new Date(Date.now() + (billing.credit_terms_days ?? 0) * 86400000).toISOString().slice(0, 10)
    : null;

  const { data: soa, error } = await supabase
    .from('revenue_soa')
    .insert({
      soa_no, billing_to_id, branch_id, period_from: effectiveFrom, period_to,
      settlement_type: billing.settlement_type,
      subtotal_cents: subtotal, total_cents: subtotal, paid_cents: 0, outstanding_cents: subtotal,
      status: 'issued', issued_date: today, due_date: dueDate,
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

interface PreparedSettleSoa {
  id: string;
  soa_no: string;
  branch_id: string;
  branchCode: string;
  period_to: string;
  total_cents: number;
  intercompany_account: string;
  intercompany_sub: string;
}

/**
 * Load + validate a list of SOAs for batch settle. Surfaces the first row that
 * can't be settled (wrong type / wrong status / no branch access / blocked
 * close-day) so the batch UI can show one clean reason instead of a half-done
 * post. Returns the dehydrated, branch-grouping-ready records.
 */
async function loadSettleable(ids: string[]): Promise<{ ok: true; rows: PreparedSettleSoa[] } | { ok: false; error: string }> {
  const supabase = await createAuditedClient();
  const { data } = await supabase
    .from('revenue_soa')
    .select('id, soa_no, status, total_cents, settlement_type, branch_id, period_to, billing:billing_destinations ( intercompany_account, intercompany_sub ), branch:branches ( code )')
    .in('id', ids);
  if (!data || data.length === 0) return { ok: false, error: 'SOA not found' };
  const rows: PreparedSettleSoa[] = [];
  for (const soa of data) {
    if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: `${soa.soa_no}: no access to this branch` };
    if (soa.settlement_type !== 'intercompany') return { ok: false, error: `${soa.soa_no}: third-party statements are settled via Record Payment` };
    if (soa.status !== 'issued') return { ok: false, error: `${soa.soa_no}: only an issued statement can be settled` };
    try { await assertNoBlockedClose(soa.branch_id); } catch (e) { return { ok: false, error: (e as Error).message }; }
    const billing = one<{ intercompany_account: string | null; intercompany_sub: string | null }>(soa.billing);
    rows.push({
      id: soa.id,
      soa_no: soa.soa_no,
      branch_id: soa.branch_id,
      branchCode: one<{ code: string }>(soa.branch)?.code ?? '',
      period_to: soa.period_to,
      total_cents: soa.total_cents,
      intercompany_account: billing?.intercompany_account ?? '50170',
      intercompany_sub: billing?.intercompany_sub ?? '000000T03',
    });
  }
  return { ok: true, rows };
}

/**
 * Atomically post ONE GL journal for a branch-grouped batch of intercompany
 * SOAs. Mirrors the Revenue Confirm batch pattern: one pushGLEntry call with
 * stacked DR cost / CR AR pairs for every SOA in the group; on success all
 * SOAs share the same gl_batch_nbr and flip to settled; on failure every SOA
 * reverts to issued + posting_status='failed'.
 *
 * GL date = max(period_to) of the group — the most recent semi-monthly cutoff
 * the journal represents. Acumatica journals carry a single date/branch, so
 * mixed-period or mixed-branch selections are split into separate groups by
 * the caller.
 */
async function postSoaSettleBatch(group: PreparedSettleSoa[]): Promise<{ ok: true; batchNbr: string | null } | { ok: false; error: string }> {
  const session = await currentSession();
  const svc = createServiceClient();
  const ids = group.map((s) => s.id);
  const branchCode = group[0]!.branchCode;
  const glDate = group.map((s) => s.period_to).sort().at(-1)!;
  const totalCents = group.reduce((sum, s) => sum + s.total_cents, 0);
  const soaNos = group.map((s) => s.soa_no);

  // Build all DR cost / CR AR lines up front so a render failure on one PDF
  // doesn't half-post the journal.
  const allLines: GLLine[] = group.flatMap((s) => {
    const amount = s.total_cents / 100;
    return [
      {
        account: s.intercompany_account,
        sub_account: s.intercompany_sub,
        debit_amount: amount,
        credit_amount: null,
        transaction_desc: `${s.soa_no} intercompany cost`,
      },
      {
        account: AR_ACCOUNT,
        sub_account: AR_SUBACCOUNT,
        debit_amount: null,
        credit_amount: amount,
        transaction_desc: `${s.soa_no} AR settle`,
      },
    ];
  });

  // Loose-typed updater — posting_status / gl_batch_nbr aren't in the generated
  // types yet. Mirrors the Revenue Confirm batch helper.
  const updateAll = (patch: Record<string, unknown>) =>
    (svc.from('revenue_soa') as unknown as { update: (p: Record<string, unknown>) => { in: (c: string, v: string[]) => Promise<unknown> } })
      .update(patch)
      .in('id', ids);

  // Acumatica not wired → flip every SOA to settled without a voucher number.
  // Keeps pre-integration flows working (same policy as postToErp).
  if (!acumaticaConfigured()) {
    await updateAll({ status: 'settled', paid_cents: 0, outstanding_cents: 0 });
    // paid_cents needs the per-row total — write each one.
    for (const s of group) {
      await svc.from('revenue_soa').update({ paid_cents: s.total_cents }).eq('id', s.id);
    }
    return { ok: true, batchNbr: null };
  }

  await updateAll({ posting_status: 'posting', posting_error: null });

  const { data: logRow } = await (svc.from('erp_posting_log') as unknown as {
    insert: (p: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null }> } };
  })
    .insert({
      entity_type: 'soa_settle_batch',
      entity_id: ids[0],
      status: 'pending',
      payload: { branch_code: branchCode, date: glDate, soa_ids: ids, soa_nos: soaNos, count: group.length, total_cents: totalCents, lines: allLines },
      posted_by_staff_id: session?.staffUserId ?? null,
      acu_session_user_id: session?.acumaticaUserId ?? null,
    })
    .select('id')
    .single();

  const cookie = await readAcuSessionCookie();
  try {
    const description = group.length === 1
      ? `${soaNos[0]} intercompany settle`
      : `Intercompany settle batch · ${group.length} SOAs (${branchCode})`;
    const res = await pushGLEntry({ date: glDate, branch: branchCode, description, currency: 'PHP', lines: allLines }, cookie);

    // One voucher, every SOA in the group references it.
    for (const s of group) {
      await (svc.from('revenue_soa') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ status: 'settled', gl_batch_nbr: res.batchNbr, posting_status: 'posted', posting_error: null, paid_cents: s.total_cents, outstanding_cents: 0 })
        .eq('id', s.id);
    }
    if (logRow) {
      await (svc.from('erp_posting_log') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ status: 'success', batch_nbr: res.batchNbr, erp_response: res.raw })
        .eq('id', logRow.id);
    }

    // Best-effort: attach each SOA's voucher PDF to the journal so reviewers
    // see the per-statement detail in Acumatica. A failure on one attach is
    // logged but doesn't unwind the post.
    if (res.batchNbr) {
      const attachErrors: string[] = [];
      for (const s of group) {
        try {
          const ra = await buildSoaAttachment(s.id);
          if (!ra) continue;
          await attachFileToJournal({ batchNbr: res.batchNbr, filename: ra.filename, fileBuffer: ra.buffer, mimeType: ra.mimeType }, cookie);
        } catch (e) {
          attachErrors.push(`${s.soa_no}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (attachErrors.length && logRow) {
        await (svc.from('erp_posting_log') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
          .update({ error_message: `Posted (batch ${res.batchNbr}) but PDF attach failed: ${attachErrors.join('; ')}` })
          .eq('id', logRow.id);
      }
    }

    return { ok: true, batchNbr: res.batchNbr };
  } catch (err) {
    const msg = (err as Error).message || 'GL push failed';
    await updateAll({ posting_status: 'failed', posting_error: msg });
    if (logRow) {
      await (svc.from('erp_posting_log') as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } })
        .update({ status: 'failed', error_message: msg })
        .eq('id', logRow.id);
    }
    return { ok: false, error: msg };
  }
}

/**
 * Settle an INTERCOMPANY statement = transfer to cost (no cash). Third-party
 * statements are settled by recording payments instead. Convenience wrapper
 * around the batch path so per-row Settle and AR-Balance batch Settle share
 * the same one-journal-per-call posting (see postSoaSettleBatch).
 */
export async function settleSOA(id: string): Promise<ActionResult> {
  const r = await settleSOABatch([id]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

/**
 * Batch-settle selected INTERCOMPANY statements as ONE GL journal per branch.
 * Acumatica journals carry a single branch + date, so a mixed selection is
 * grouped by branch (and dated at the group's max period_to). Within a branch
 * group every SOA shares the same gl_batch_nbr — exactly like Revenue Confirm
 * batches Sales Orders into one voucher per branch/day.
 *
 * GL date policy = max(period_to) of the branch group: the cost transfer's
 * accounting period matches the semi-monthly cutoff the SOAs represent, not
 * the day a manager happened to click Settle (mirrors per-SOA policy).
 */
export async function settleSOABatch(ids: string[]): Promise<ActionResult<{ settled: number; batchNbrs: string[] }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  if (!ids.length) return { ok: false, error: 'Select at least one intercompany statement' };

  const prepared = await loadSettleable(ids);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  // Group by branch — one journal per branch (Acumatica journal = single branch).
  const byBranch = new Map<string, PreparedSettleSoa[]>();
  for (const s of prepared.rows) {
    const g = byBranch.get(s.branch_id) ?? [];
    g.push(s);
    byBranch.set(s.branch_id, g);
  }

  let settled = 0;
  const batchNbrs: string[] = [];
  const errors: string[] = [];
  for (const group of byBranch.values()) {
    const r = await postSoaSettleBatch(group);
    if (r.ok) {
      settled += group.length;
      if (r.batchNbr) batchNbrs.push(r.batchNbr);
    } else {
      errors.push(r.error);
    }
  }
  void session;

  if (settled === 0) return { ok: false, error: errors[0] ?? 'Nothing to settle' };
  revalidatePath('/reconciliation/soa');
  return { ok: true, data: { settled, batchNbrs } };
}

// PHT (Asia/Manila) today as yyyy-mm-dd — the latest acceptable paid_at.
const todayPHT = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const paymentSchema = z.object({
  soa_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  payment_method: z.string().max(60).optional().nullable(),
  reference_no: z.string().max(120).optional().nullable(),
  paid_at: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
    .refine((d) => d <= todayPHT(), 'Date received cannot be in the future')
    .optional(),
  note: z.string().max(300).optional().nullable(),
  proof_file_path: z.string().max(400).optional().nullable(),
});

/**
 * Compose + post the GL entry for a third-party SOA collection. Resolves the
 * branch's settle transaction_code by payment method (cash → DR 10108, bank →
 * DR 10111, both CR 10200), and posts via postToErp with the proof attached.
 * Shared by recordSoaPayment (first attempt) and retrySoaPaymentPosting.
 */
async function postSoaPaymentToErp(args: {
  paymentId: string;
  soaId: string;
  soaNo: string;
  branchId: string;
  branchCode: string;
  paidAtIso: string;
  amountCents: number;
  methodCode: string;
  proofPath: string | null;
}): Promise<PostToErpResult> {
  const supabase = await createAuditedClient();
  const amount = args.amountCents / 100;
  const { data: pm } = await supabase.from('payment_methods').select('id').eq('code', args.methodCode).maybeSingle();
  if (!pm) return { ok: false, error: `No payment method "${args.methodCode}"` };
  const { data: tx } = await supabase
    .from('transaction_codes')
    .select('debit_account, debit_subaccount, credit_account, credit_subaccount')
    .eq('branch_id', args.branchId)
    .eq('transaction_type', 'settle')
    .eq('payment_method_id', pm.id)
    .eq('active', true)
    .maybeSingle();
  if (!tx?.debit_account || !tx?.credit_account) {
    return { ok: false, error: `No settle transaction code configured for ${args.methodCode}` };
  }
  const tag = args.soaNo;
  // Pre-render the SOA voucher PDF — attached alongside the cash/bank proof so
  // Acumatica reviewers see both the receipt evidence AND the statement detail.
  const renderedAttachment = await buildSoaAttachment(args.soaId);
  return await postToErp({
    entityType: 'soa_payment',
    table: 'revenue_soa_payments',
    entityId: args.paymentId,
    date: args.paidAtIso.slice(0, 10),
    branch: args.branchCode,
    description: `${tag} AR collection (${args.methodCode})`.trim(),
    lines: [
      { account: tx.debit_account, sub_account: tx.debit_subaccount ?? '000000000', debit_amount: amount, credit_amount: null, transaction_desc: `${tag} ${args.methodCode} receipt`.trim() },
      { account: tx.credit_account, sub_account: tx.credit_subaccount ?? '000000000', debit_amount: null, credit_amount: amount, transaction_desc: `${tag} AR settle`.trim() },
    ],
    proofPath: args.proofPath ?? undefined,
    renderedAttachment,
  });
}

/**
 * Record a (possibly partial) payment against a THIRD-PARTY statement. Updates
 * paid / outstanding and flips to partial_paid or settled, then posts the cash
 * receipt to ERP: DR cash/bank (per method, from transaction_codes) / CR AR.
 */
export async function recordSoaPayment(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { soa_id, amount, payment_method, reference_no, paid_at, note, proof_file_path } = parsed.data;
  const supabase = await createAuditedClient();
  const { data: soa } = await supabase
    .from('revenue_soa')
    .select('soa_no, status, total_cents, paid_cents, settlement_type, branch_id, branch:branches ( code )')
    .eq('id', soa_id)
    .single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (soa.settlement_type !== 'third_party') return { ok: false, error: 'Record Payment is for third-party statements; intercompany uses Settle' };
  if (!['issued', 'partial_paid'].includes(soa.status)) return { ok: false, error: 'This statement is not open for payment' };
  try { await assertNoBlockedClose(soa.branch_id); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const amountCents = Math.round(amount * 100);
  const outstanding = soa.total_cents - soa.paid_cents;
  if (amountCents > outstanding) return { ok: false, error: `Amount exceeds the outstanding balance (${(outstanding / 100).toLocaleString('en-PH')})` };

  // Cash physically lands in today's till, so it's stamped with the real time of
  // entry and feeds the shift cash count via cashReceivedCents. Non-cash methods
  // are back-office (no till impact) and keep the recorded date.
  const isCash = (payment_method ?? '').toLowerCase() === 'cash';
  const paidAtIso = isCash
    ? new Date().toISOString()
    : (paid_at ? `${paid_at}T00:00:00+08:00` : new Date().toISOString());
  const ins = await supabase
    .from('revenue_soa_payments')
    .insert({
      soa_id, amount_cents: amountCents, paid_at: paidAtIso,
      payment_method: payment_method || null, reference_no: reference_no || null, note: note || null,
      proof_file_path: proof_file_path || null,
      recorded_by: session!.staffUserId,
    } as never)
    .select('id')
    .single();
  if (ins.error || !ins.data) return { ok: false, error: ins.error?.message ?? 'Payment insert failed' };
  const paymentId = (ins.data as { id: string }).id;

  const newPaid = soa.paid_cents + amountCents;
  const newOutstanding = soa.total_cents - newPaid;
  const upd = await supabase
    .from('revenue_soa')
    .update({ paid_cents: newPaid, outstanding_cents: newOutstanding, status: newOutstanding <= 0 ? 'settled' : 'partial_paid' })
    .eq('id', soa_id);
  if (upd.error) return { ok: false, error: upd.error.message };

  // ERP: clear the receivable — DR cash/bank (per method, from transaction_codes
  // settle code), CR AR + attach the proof. The payment is already recorded; a
  // posting failure is noted on the payment row (retriable), it doesn't undo
  // the collection. No-op until Acumatica is configured. Intercompany uses
  // settleSOA, not this path.
  await postSoaPaymentToErp({
    paymentId,
    soaId: soa_id,
    soaNo: soa.soa_no ?? '',
    branchId: soa.branch_id,
    branchCode: one<{ code: string }>(soa.branch)?.code ?? '',
    paidAtIso,
    amountCents,
    methodCode: (payment_method ?? '').toLowerCase(),
    proofPath: proof_file_path ?? null,
  });

  revalidatePath('/reconciliation/soa');
  // A cash collection feeds the shift cash count — refresh that page too.
  if (isCash) revalidatePath('/reconciliation/cash');
  return { ok: true };
}

/**
 * Re-attempt the ERP posting for a SOA payment whose previous posting failed.
 * Reads the payment + parent SOA, then re-runs the same compose-and-post via
 * postSoaPaymentToErp. The payment row's posting_status/error/batch_nbr is
 * updated by postToErp's own contract (success → posted + batch + attach proof;
 * failure → still failed, error refreshed, retried_count incremented in the
 * log). Manager-gated; only valid for rows that aren't already posted.
 */
export async function retrySoaPaymentPosting(paymentId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();

  // The new columns (posting_status / proof_file_path / ...) aren't in the
  // generated types yet — cast the read.
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          maybeSingle: () => Promise<{
            data: {
              id: string;
              soa_id: string;
              amount_cents: number;
              payment_method: string | null;
              paid_at: string;
              proof_file_path: string | null;
              posting_status: string | null;
            } | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  const pr = await sb
    .from('revenue_soa_payments')
    .select('id, soa_id, amount_cents, payment_method, paid_at, proof_file_path, posting_status')
    .eq('id', paymentId)
    .maybeSingle();
  if (!pr.data) return { ok: false, error: 'Payment not found' };
  const pay = pr.data;
  if (pay.posting_status === 'posted') return { ok: false, error: 'Already posted to ERP' };

  const { data: soa } = await supabase
    .from('revenue_soa')
    .select('soa_no, branch_id, branch:branches ( code )')
    .eq('id', pay.soa_id)
    .single();
  if (!soa) return { ok: false, error: 'Statement not found' };
  if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: 'No access to this branch' };

  const r = await postSoaPaymentToErp({
    paymentId: pay.id,
    soaId: pay.soa_id,
    soaNo: soa.soa_no ?? '',
    branchId: soa.branch_id,
    branchCode: one<{ code: string }>(soa.branch)?.code ?? '',
    paidAtIso: pay.paid_at,
    amountCents: pay.amount_cents,
    methodCode: (pay.payment_method ?? '').toLowerCase(),
    proofPath: pay.proof_file_path ?? null,
  });
  revalidatePath('/reconciliation/soa');
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

/** Upload an AR collection proof (remittance slip / cash photo) to the private
 *  ar-proofs bucket. Returns the storage path to store on the payment row. */
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

export interface SoaPaymentRow {
  id: string;
  amount_cents: number;
  paid_at: string;
  payment_method: string | null;
  reference_no: string | null;
  posting_status: string | null;
  gl_batch_nbr: string | null;
  posting_error: string | null;
  proof_file_path: string | null;
}

/** Payments recorded against a SOA, most recent first. Carries the per-payment
 *  GL batch / posting status + the proof attachment path. */
export async function loadSoaPayments(soa_id: string): Promise<SoaPaymentRow[]> {
  const supabase = await createAuditedClient();
  const { data: soa } = await supabase.from('revenue_soa').select('branch_id').eq('id', soa_id).maybeSingle();
  if (!soa?.branch_id || !(await canAccessBranch(soa.branch_id))) return [];
  // The new posting / proof columns aren't in the generated DB types yet — cast.
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          order: (k: string, o?: { ascending: boolean }) => Promise<{ data: SoaPaymentRow[] | null; error: unknown }>;
        };
      };
    };
  };
  const r = await sb
    .from('revenue_soa_payments')
    .select('id, amount_cents, paid_at, payment_method, reference_no, posting_status, gl_batch_nbr, posting_error, proof_file_path')
    .eq('soa_id', soa_id)
    .order('paid_at', { ascending: false });
  return r.data ?? [];
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

export async function voidSOA(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: soa } = await supabase.from('revenue_soa').select('status, branch_id').eq('id', id).single();
  if (!soa) return { ok: false, error: 'SOA not found' };
  if (!soa.branch_id || !(await canAccessBranch(soa.branch_id))) return { ok: false, error: 'No access to this branch' };
  // Only an issued statement (no payments, not yet settled) can be plain-voided.
  // An `issued` SOA always has paid_cents = 0 — a payment flips it to
  // partial_paid/settled — so once money or a cost-transfer is on it, voiding
  // would orphan those records and double-count the released orders. Those need
  // a reversal/adjustment instead.
  if (soa.status !== 'issued') {
    return { ok: false, error: 'Only an issued statement with no payments can be voided; a settled or partly-paid statement needs a reversal/adjustment.' };
  }
  // Release the orders so they can be re-stated.
  await supabase.from('revenue_soa_orders').delete().eq('soa_id', id);
  const { error } = await supabase.from('revenue_soa').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/soa');
  return { ok: true };
}
