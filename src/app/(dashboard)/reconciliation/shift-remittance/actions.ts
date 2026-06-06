'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { getBranchShiftConfig } from '../cash/actions';
import { isBusinessDayClosed } from '../end-of-day/actions';
import { windowsFromConfig, formatWindow } from '../cash/shifts';

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

export interface ShiftRow {
  id: string;
  label: string;
  status: 'open' | 'closed';
  openedAt: string | null;
  closedAt: string | null;
  openingFloatCents: number;
  closingCountCents: number | null;
  varianceCents: number | null;
  varianceReason: string | null;
}

/** The branch's shifts for a day, in config order (so the Remittance page can
 *  list every configured shift, opened or not). */
export async function listShiftsForDay(branchId: string, date: string): Promise<ShiftRow[]> {
  const supabase = await createAuditedClient();
  const { data } = await supabase
    .from('shifts')
    .select('id, label, status, opened_at, closed_at, opening_float_cents, closing_count_cents, variance_cents, variance_reason')
    .eq('branch_id', branchId)
    .eq('business_date', date);
  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status as 'open' | 'closed',
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openingFloatCents: s.opening_float_cents,
    closingCountCents: s.closing_count_cents,
    varianceCents: s.variance_cents,
    varianceReason: s.variance_reason,
  }));
}

export interface ShiftRemittance {
  label: string;
  windowLabel: string;
  firstOfDay: boolean;
  shift: ShiftRow | null;     // the shifts row once opened, else null
  revenueCents: number;       // folio revenue posted into this shift
  cashCents: number;          // cash payments posted into this shift
  nonCashCents: number;       // card / other payments
  expectedCashCents: number;  // opening float + cash
}

/** Every configured shift for the branch/day (opened or not) with its folio
 *  totals — the data the Shift Remittance page lists. Folio totals are 0 until
 *  the posting paths land; the structure is ready for them. */
export async function loadShiftRemittance(branchId: string, date: string): Promise<ShiftRemittance[]> {
  const supabase = await createAuditedClient();
  const cfg = await getBranchShiftConfig(branchId);
  const windows = windowsFromConfig(cfg);

  const { data: rows } = await supabase
    .from('shifts')
    .select('id, label, status, opened_at, closed_at, opening_float_cents, closing_count_cents, variance_cents, variance_reason')
    .eq('branch_id', branchId)
    .eq('business_date', date);
  const byLabel = new Map((rows ?? []).map((r) => [r.label, r]));

  // Folio aggregates per opened shift (revenue + cash/non-cash payments).
  const agg = new Map<string, { revenue: number; cash: number; nonCash: number }>();
  const shiftIds = (rows ?? []).map((r) => r.id);
  if (shiftIds.length > 0) {
    const { data: lines } = await supabase
      .from('folio_lines')
      .select('shift_id, kind, amount_cents, method:payment_methods!folio_lines_payment_method_id_fkey ( code )')
      .in('shift_id', shiftIds);
    for (const l of lines ?? []) {
      const a = agg.get(l.shift_id) ?? { revenue: 0, cash: 0, nonCash: 0 };
      // Tips are recognised revenue now, so they count toward the shift's
      // posted revenue alongside service revenue (keeps revenue == payments).
      if (l.kind === 'revenue' || l.kind === 'tip') a.revenue += l.amount_cents;
      else if (l.kind === 'payment') {
        if ((one(l.method)?.code ?? '').toLowerCase() === 'cash') a.cash += l.amount_cents;
        else a.nonCash += l.amount_cents;
      }
      agg.set(l.shift_id, a);
    }
  }

  return windows.map((w, i) => {
    const row = byLabel.get(w.name) ?? null;
    const a = (row && agg.get(row.id)) || { revenue: 0, cash: 0, nonCash: 0 };
    const shift: ShiftRow | null = row
      ? {
          id: row.id, label: row.label, status: row.status as 'open' | 'closed',
          openedAt: row.opened_at, closedAt: row.closed_at,
          openingFloatCents: row.opening_float_cents, closingCountCents: row.closing_count_cents,
          varianceCents: row.variance_cents, varianceReason: row.variance_reason,
        }
      : null;
    return {
      label: w.name,
      windowLabel: formatWindow(w.start, w.end),
      firstOfDay: i === 0,
      shift,
      revenueCents: a.revenue,
      cashCents: a.cash,
      nonCashCents: a.nonCash,
      expectedCashCents: (shift?.openingFloatCents ?? 0) + a.cash,
    };
  });
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

/** The branch's currently-open shift, or null. This is the "home" a posting
 *  (revenue on Start, payment on takePayment) will bind to — the guard those
 *  paths use lands in a later step; for now it's just a read. */
/** Cancelled orders (status='void') for this branch+date that still have a
 *  non-zero balance (paid != 0 or total != 0). The desk should settle them. */
export interface CancelledWithDue {
  id: string;
  order_no: string;
  totalCents: number;
  paidCents: number;
}
export async function loadCancelledWithDue(branchId: string, date: string): Promise<CancelledWithDue[]> {
  const supabase = await createAuditedClient();
  const { data } = await supabase
    .from('orders')
    .select('id, order_no, total_cents, paid_cents')
    .eq('branch_id', branchId)
    .eq('service_date', date)
    .eq('status', 'void')
    .is('deleted_at', null);
  return (data ?? [])
    .filter((o) => (o.total_cents ?? 0) !== 0 || (o.paid_cents ?? 0) !== 0)
    .map((o) => ({
      id: o.id,
      order_no: o.order_no,
      totalCents: o.total_cents ?? 0,
      paidCents: o.paid_cents ?? 0,
    }));
}

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
  revalidatePath('/reconciliation/shift-remittance');
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
