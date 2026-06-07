'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { getBranchShiftConfig } from '../cash/actions';
import { isBusinessDayClosed } from '../end-of-day/actions';
import { postShiftToErp } from '@/lib/shift-erp-posting';

export type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Cash that should be in the drawer for a shift = opening float + cash posted
 *  to this shift's folio lines. Folio is empty until the posting paths land, so
 *  today this is just the float; the join is ready for when payments write. */
async function shiftCashExpected(
  supabase: Awaited<ReturnType<typeof createAuditedClient>>,
  shiftId: string,
  openingFloatCents: number,
): Promise<number> {
  const { data: lines } = await supabase
    .from('folio_lines')
    .select('amount_cents, kind, method:payment_methods!folio_lines_payment_method_id_fkey ( code )')
    .eq('shift_id', shiftId);
  const cashIn = (lines ?? [])
    .filter((l) => l.kind === 'payment' && (one(l.method)?.code ?? '').toLowerCase() === 'cash')
    .reduce((s, l) => s + l.amount_cents, 0);
  const cashOut = (lines ?? [])
    .filter((l) => l.kind === 'refund' && (one(l.method)?.code ?? '').toLowerCase() === 'cash')
    .reduce((s, l) => s + l.amount_cents, 0);
  return openingFloatCents + cashIn - cashOut;
}

export interface ShiftListItem {
  id: string;
  branchId: string;
  branchCode: string;
  businessDate: string;
  label: string;
  status: 'open' | 'closed';
  openedByName: string | null;
  openedAt: string | null;
  closedAt: string | null;
  openingFloatCents: number;
  closingCountCents: number | null;
  varianceCents: number | null;
  varianceReason: string | null;
  revenueCents: number;
  cashCents: number;
  nonCashCents: number;
  expectedCashCents: number;
  firstOfDay: boolean;
}

/** Flat list of shifts across the given branches (no date filter) for the
 *  Remittance list view — newest first, capped so it can't grow unbounded.
 *  Carries the opener's name + per-shift folio totals. */
export async function loadAllShifts(branchIds: string[]): Promise<ShiftListItem[]> {
  if (branchIds.length === 0) return [];
  const supabase = await createAuditedClient();
  const { data: rows } = await supabase
    .from('shifts')
    .select('id, branch_id, business_date, label, status, opened_at, closed_at, opening_float_cents, closing_count_cents, variance_cents, variance_reason, opener:staff_users!shifts_opened_by_fkey ( display_name, email ), branch:branches!shifts_branch_id_fkey ( code )')
    .in('branch_id', branchIds)
    .order('business_date', { ascending: false })
    .order('opened_at', { ascending: false })
    .limit(200);

  // Folio aggregates per shift (revenue + tips, cash vs non-cash payments).
  const ids = (rows ?? []).map((r) => r.id);
  const agg = new Map<string, { revenue: number; cash: number; nonCash: number }>();
  if (ids.length > 0) {
    const { data: lines } = await supabase
      .from('folio_lines')
      .select('shift_id, kind, amount_cents, method:payment_methods!folio_lines_payment_method_id_fkey ( code )')
      .in('shift_id', ids);
    for (const l of lines ?? []) {
      const a = agg.get(l.shift_id) ?? { revenue: 0, cash: 0, nonCash: 0 };
      if (l.kind === 'revenue' || l.kind === 'tip') a.revenue += l.amount_cents;
      else if (l.kind === 'payment') {
        if ((one(l.method)?.code ?? '').toLowerCase() === 'cash') a.cash += l.amount_cents;
        else a.nonCash += l.amount_cents;
      }
      agg.set(l.shift_id, a);
    }
  }

  // First shift of a (branch, day) carries no handover float. Rows are sorted
  // opened_at DESC, so the LAST row seen for a key is the earliest = first.
  const firstByDay = new Map<string, string>();
  for (const r of rows ?? []) firstByDay.set(`${r.branch_id}|${r.business_date}`, r.id);

  return (rows ?? []).map((r) => {
    const a = agg.get(r.id) ?? { revenue: 0, cash: 0, nonCash: 0 };
    const opener = one(r.opener);
    return {
      id: r.id,
      branchId: r.branch_id,
      branchCode: one(r.branch)?.code ?? '—',
      businessDate: r.business_date,
      label: r.label,
      status: r.status as 'open' | 'closed',
      openedByName: opener?.display_name ?? opener?.email ?? null,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      openingFloatCents: r.opening_float_cents,
      closingCountCents: r.closing_count_cents,
      varianceCents: r.variance_cents,
      varianceReason: r.variance_reason,
      revenueCents: a.revenue,
      cashCents: a.cash,
      nonCashCents: a.nonCash,
      expectedCashCents: r.opening_float_cents + a.cash,
      firstOfDay: firstByDay.get(`${r.branch_id}|${r.business_date}`) === r.id,
    };
  });
}

/** Configured shift labels per branch, for the "Open shift" dialog's pickers. */
export async function loadShiftLabelOptions(branchIds: string[]): Promise<{ branchId: string; labels: string[] }[]> {
  const cfgs = await Promise.all(branchIds.map((id) => getBranchShiftConfig(id)));
  return branchIds.map((branchId, i) => ({ branchId, labels: cfgs[i].shifts.map((s) => s.name) }));
}

export interface ShiftMethodRow {
  code: string;
  method: string;
  expectedCents: number;
  declaredCents: number | null; // null = not counted yet (open cash row)
  overShortCents: number | null;
  countable: boolean; // cash → physically counted on close
}
export interface ShiftFolioLine {
  id: string;
  postedAt: string;
  orderId: string | null;
  orderNo: string | null;
  kind: string;
  method: string | null;
  ref: string | null;
  amountCents: number;
}
export interface ShiftRevenueLine {
  id: string;
  postedAt: string;
  orderId: string | null;
  orderNo: string | null;
  category: string;
  amountCents: number;
}
export interface ShiftDetail {
  id: string;
  branchId: string;
  branchCode: string;
  businessDate: string;
  label: string;
  status: 'open' | 'closed';
  openedAt: string | null;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  openingFloatCents: number;
  closingCountCents: number | null;
  varianceCents: number | null;
  varianceReason: string | null;
  firstOfDay: boolean;
  revenueTotalCents: number;
  revenueByCategory: { name: string; cents: number }[];
  methodRows: ShiftMethodRow[];
  cashExpectedCents: number;
  paymentsExpectedTotalCents: number;
  revenueLines: ShiftRevenueLine[];
  folioLines: ShiftFolioLine[];
  postingStatus: string | null;
  glBatchNbr: string | null;
  postingError: string | null;
}

/** One shift's full remittance detail: revenue total, payments rolled up per
 *  method (cash carrying its counted/variance), and the raw collected-payment
 *  folio lines. Cash is the only physically-counted method. */
export async function loadShiftDetail(shiftId: string): Promise<ShiftDetail | null> {
  const supabase = await createAuditedClient();
  const { data: s } = await supabase
    .from('shifts')
    .select('id, branch_id, business_date, label, status, opened_at, closed_at, opening_float_cents, closing_count_cents, variance_cents, variance_reason, posting_status, gl_batch_nbr, posting_error, opener:staff_users!shifts_opened_by_fkey ( display_name, email ), closer:staff_users!shifts_closed_by_fkey ( display_name, email ), branch:branches!shifts_branch_id_fkey ( code )')
    .eq('id', shiftId)
    .maybeSingle();
  if (!s) return null;
  if (!(await canAccessBranch(s.branch_id))) return null;

  // First shift of the (branch, day) shows no handover float.
  const { data: first } = await supabase
    .from('shifts').select('id')
    .eq('branch_id', s.branch_id).eq('business_date', s.business_date)
    .order('opened_at', { ascending: true }).limit(1).maybeSingle();

  const { data: lines } = await supabase
    .from('folio_lines')
    .select('id, kind, amount_cents, posted_at, payment_ref, method:payment_methods!folio_lines_payment_method_id_fkey ( code, display_name ), order:orders!folio_lines_order_id_fkey ( id, order_no ), item:order_items!folio_lines_order_item_id_fkey ( category:service_categories ( name ) )')
    .eq('shift_id', shiftId)
    .order('posted_at', { ascending: false });

  let revenueTotal = 0;
  let cashIn = 0;
  let cashOut = 0;
  const methodAgg = new Map<string, { display: string; cents: number }>();
  const revenueByCat = new Map<string, number>();
  const revenueLines: ShiftRevenueLine[] = [];
  const folioLines: ShiftFolioLine[] = [];
  for (const l of lines ?? []) {
    const m = one(l.method);
    const ord = one(l.order);
    if (l.kind === 'revenue' || l.kind === 'tip') {
      revenueTotal += l.amount_cents;
      const catName = l.kind === 'tip' ? 'Tips' : (one(one(l.item)?.category)?.name ?? 'Service');
      revenueByCat.set(catName, (revenueByCat.get(catName) ?? 0) + l.amount_cents);
      revenueLines.push({ id: l.id, postedAt: l.posted_at, orderId: ord?.id ?? null, orderNo: ord?.order_no ?? null, category: catName, amountCents: l.amount_cents });
      continue;
    }
    if (l.kind !== 'payment' && l.kind !== 'refund') continue;
    const code = (m?.code ?? 'other').toLowerCase();
    const cur = methodAgg.get(code) ?? { display: m?.display_name ?? 'Other', cents: 0 };
    cur.cents += l.kind === 'refund' ? -l.amount_cents : l.amount_cents;
    methodAgg.set(code, cur);
    if (code === 'cash') { if (l.kind === 'payment') cashIn += l.amount_cents; else cashOut += l.amount_cents; }
    folioLines.push({
      id: l.id, postedAt: l.posted_at, orderId: ord?.id ?? null, orderNo: ord?.order_no ?? null,
      kind: l.kind, method: m?.display_name ?? null, ref: l.payment_ref ?? null, amountCents: l.amount_cents,
    });
  }
  const closed = s.status === 'closed';
  const cashExpected = s.opening_float_cents + cashIn - cashOut;

  const methodRows: ShiftMethodRow[] = [];
  // Cash row always shown (it's the counted drawer, even with only a float).
  methodRows.push({
    code: 'cash',
    method: methodAgg.get('cash')?.display ?? 'Cash',
    expectedCents: cashExpected,
    declaredCents: closed ? (s.closing_count_cents ?? 0) : null,
    overShortCents: closed ? (s.variance_cents ?? 0) : null,
    countable: true,
  });
  for (const [code, v] of methodAgg) {
    if (code === 'cash') continue;
    methodRows.push({ code, method: v.display, expectedCents: v.cents, declaredCents: v.cents, overShortCents: 0, countable: false });
  }

  const opener = one(s.opener);
  const closer = one(s.closer);
  return {
    id: s.id,
    branchId: s.branch_id,
    branchCode: one(s.branch)?.code ?? '—',
    businessDate: s.business_date,
    label: s.label,
    status: s.status as 'open' | 'closed',
    openedAt: s.opened_at,
    openedByName: opener?.display_name ?? opener?.email ?? null,
    closedAt: s.closed_at,
    closedByName: closer?.display_name ?? closer?.email ?? null,
    openingFloatCents: s.opening_float_cents,
    closingCountCents: s.closing_count_cents,
    varianceCents: s.variance_cents,
    varianceReason: s.variance_reason,
    firstOfDay: first?.id === s.id,
    revenueTotalCents: revenueTotal,
    revenueByCategory: [...revenueByCat.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
    methodRows,
    cashExpectedCents: cashExpected,
    paymentsExpectedTotalCents: [...methodAgg.values()].reduce((a, b) => a + b.cents, 0),
    revenueLines,
    folioLines,
    postingStatus: (s as { posting_status: string | null }).posting_status ?? null,
    glBatchNbr: (s as { gl_batch_nbr: string | null }).gl_batch_nbr ?? null,
    postingError: (s as { posting_error: string | null }).posting_error ?? null,
  };
}

export interface UnsettledOrder {
  id: string;
  orderNo: string;
  branchCode: string;
  totalCents: number;
  paidCents: number;
  status: string;
}
/** Pre-close pipeline checks across the given branches:
 *  - cancelled (void) orders that still carry a non-zero due (total ≠ paid);
 *  - orders with a non-zero due whose SO has NO in-service line right now
 *    (owe money but nothing's being served — they should be settled).
 *  `cutoffDate` is the shift's remittance (business) date: only orders dated on
 *  or before it are checked, so closing a shift late doesn't get blocked by
 *  future-dated orders that belong to a later shift. */
export async function loadRemittanceChecks(branchIds: string[], cutoffDate?: string): Promise<{ cancelledWithDue: UnsettledOrder[]; dueNotInService: UnsettledOrder[] }> {
  if (branchIds.length === 0) return { cancelledWithDue: [], dueNotInService: [] };
  const supabase = await createAuditedClient();
  const { data: brs } = await supabase.from('branches').select('id, code').in('id', branchIds);
  const codeById = new Map((brs ?? []).map((b) => [b.id, b.code]));
  let q = supabase
    .from('orders')
    .select('id, order_no, status, total_cents, paid_cents, branch_id, order_items ( status )')
    .in('branch_id', branchIds)
    .is('deleted_at', null)
    .neq('status', 'closed');
  if (cutoffDate) q = q.lte('service_date', cutoffDate);
  const { data: orders } = await q;

  const cancelledWithDue: UnsettledOrder[] = [];
  const dueNotInService: UnsettledOrder[] = [];
  for (const o of orders ?? []) {
    const due = (o.total_cents ?? 0) - (o.paid_cents ?? 0);
    if (due === 0) continue;
    const row: UnsettledOrder = {
      id: o.id, orderNo: o.order_no, branchCode: codeById.get(o.branch_id) ?? '—',
      totalCents: o.total_cents ?? 0, paidCents: o.paid_cents ?? 0, status: o.status,
    };
    if (o.status === 'void') { cancelledWithDue.push(row); continue; }
    const hasInService = (o.order_items ?? []).some((it) => it.status === 'in_service');
    if (!hasInService) dueNotInService.push(row);
  }
  return { cancelledWithDue, dueNotInService };
}

/** The branch's currently-open shift, or null. This is the "home" a posting
 *  (revenue on Start, payment on takePayment) will bind to — the guard those
 *  paths use lands in a later step; for now it's just a read. */
export async function getCurrentOpenShift(branchId: string): Promise<{ id: string; label: string } | null> {
  const supabase = await createAuditedClient();
  const { data } = await supabase
    .from('shifts')
    .select('id, label')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .maybeSingle();
  return data ?? null;
}

const openSchema = z.object({
  branch_id: z.string().uuid(),
  date: z.string().min(1),
  label: z.string().min(1),
});

/** Open a shift: the cashier on duty opens their drawer before any posting can
 *  land in it. One open shift per branch at a time. */
export async function openShift(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (await isBusinessDayClosed(d.branch_id, d.date)) {
    return { ok: false, error: 'The business day is closed for this branch — no shift can be opened.' };
  }

  // Label must be one this branch actually runs (from cash_shift_config).
  const cfg = await getBranchShiftConfig(d.branch_id);
  if (!cfg.shifts.some((s) => s.name === d.label)) {
    return { ok: false, error: 'That shift is not configured for this branch' };
  }

  const supabase = await createAuditedClient();

  // Only one shift open per branch — a posting must bind to an unambiguous home.
  const { data: openRow } = await supabase
    .from('shifts').select('label').eq('branch_id', d.branch_id).eq('status', 'open').maybeSingle();
  if (openRow) return { ok: false, error: `Shift "${openRow.label}" is still open — close it first.` };

  // A given shift label opens once per day.
  const { data: existing } = await supabase
    .from('shifts').select('status').eq('branch_id', d.branch_id).eq('business_date', d.date).eq('label', d.label).maybeSingle();
  if (existing) {
    return { ok: false, error: existing.status === 'closed' ? 'This shift is already closed for the day.' : 'This shift is already open.' };
  }

  // Opening float = the handover from the last shift closed today (first shift = 0).
  const { data: prev } = await supabase
    .from('shifts').select('closing_count_cents')
    .eq('branch_id', d.branch_id).eq('business_date', d.date).eq('status', 'closed')
    .order('closed_at', { ascending: false }).limit(1).maybeSingle();
  const opening = prev?.closing_count_cents ?? 0;

  const { data: created, error } = await supabase
    .from('shifts')
    .insert({
      branch_id: d.branch_id, business_date: d.date, label: d.label, status: 'open',
      opened_by: session.staffUserId, opening_float_cents: opening,
    })
    .select('id').single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/shift-remittance');
  return { ok: true, id: created.id };
}

const closeSchema = z.object({
  shift_id: z.string().uuid(),
  actual_count: z.coerce.number().min(0),
  variance_reason: z.string().max(300).optional().nullable(),
});

/** Close a shift: count the drawer. Expected = float + cash posted to the
 *  shift; a non-zero variance needs a reason. Once closed, no new posting may
 *  bind to it (that guard lands with the posting paths). */
export async function closeShift(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const supabase = await createAuditedClient();
  const { data: shift } = await supabase
    .from('shifts').select('id, branch_id, status, opening_float_cents').eq('id', d.shift_id).single();
  if (!shift) return { ok: false, error: 'Shift not found' };
  if (!(await canAccessBranch(shift.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (shift.status !== 'open') return { ok: false, error: 'This shift is already closed' };

  const expected = await shiftCashExpected(supabase, shift.id, shift.opening_float_cents);
  const actual = Math.round(d.actual_count * 100);
  const variance = actual - expected;
  if (variance !== 0 && (!d.variance_reason || d.variance_reason.trim().length < 3)) {
    return { ok: false, error: 'A variance reason is required when the count does not match' };
  }

  const { error } = await supabase
    .from('shifts')
    .update({
      status: 'closed',
      closed_by: session.staffUserId,
      closed_at: new Date().toISOString(),
      closing_count_cents: actual,
      variance_cents: variance,
      variance_reason: variance !== 0 ? d.variance_reason?.trim() ?? null : null,
    })
    .eq('id', d.shift_id)
    .eq('status', 'open');
  if (error) return { ok: false, error: error.message };

  // Unified ERP posting: aggregate this shift's folio lines into one GL journal.
  // Best-effort — the shift is closed regardless; a posting failure lands on the
  // shift row (posting_status='failed') and is retriable. No-op until Acumatica
  // is configured.
  await postShiftToErp(d.shift_id);

  revalidatePath('/reconciliation/shift-remittance');
  return { ok: true };
}

/** Re-attempt the ERP post for a closed shift whose previous post failed (or was
 *  skipped because Acumatica wasn't yet configured). Manager-gated. */
export async function retryShiftPosting(shiftId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  const { data: shift } = await supabase.from('shifts').select('branch_id').eq('id', shiftId).maybeSingle();
  if (!shift) return { ok: false, error: 'Shift not found' };
  if (!(await canAccessBranch(shift.branch_id))) return { ok: false, error: 'No access to this branch' };
  const r = await postShiftToErp(shiftId);
  revalidatePath('/reconciliation/shift-remittance');
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

const reopenSchema = z.object({
  shift_id: z.string().uuid(),
  reason: z.string().min(3, 'A reason is required').max(300),
});

/** Reopen a closed shift (miscount, late cash). Manager only. Refuses if the
 *  branch already has another shift open. */
export async function reopenShift(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to reopen' };
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const supabase = await createAuditedClient();
  const { data: shift } = await supabase
    .from('shifts').select('branch_id, status').eq('id', d.shift_id).single();
  if (!shift) return { ok: false, error: 'Shift not found' };
  if (!(await canAccessBranch(shift.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (shift.status !== 'closed') return { ok: false, error: 'This shift is not closed' };

  const { data: openRow } = await supabase
    .from('shifts').select('label').eq('branch_id', shift.branch_id).eq('status', 'open').maybeSingle();
  if (openRow) return { ok: false, error: `Shift "${openRow.label}" is open — close it before reopening another.` };

  const { error } = await supabase
    .from('shifts')
    .update({ status: 'open', closed_by: null, closed_at: null, note: `Reopened: ${d.reason.trim()}` })
    .eq('id', d.shift_id)
    .eq('status', 'closed');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/shift-remittance');
  return { ok: true };
}
