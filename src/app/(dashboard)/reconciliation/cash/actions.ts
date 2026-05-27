'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager, isAdmin } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import {
  SHIFT_LABELS, SHIFT_ORDER, CASH_SHIFTS_SETTING_KEY as SETTING_KEY, CASH_WINDOWS_SETTING_KEY,
  DEFAULT_AM_PM_CUT, DEFAULT_PM_NIGHT_CUT, buildWindows, hhmmToMin, minToHHMM, formatWindow,
  type ShiftLabel, type ShiftStatus,
} from './shifts';

export type ActionResult = { ok: true } | { ok: false; error: string };

function minuteOfDayPHT(iso: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
}
function nextDate(date: string): string {
  // Pure-UTC arithmetic so the result is independent of the server's local
  // timezone. Parsing "YYYY-MM-DDT00:00:00" as local time then calling
  // toISOString() shifts the day back by the UTC offset (e.g. in PHT, +1 day
  // lands on the same date again), which collapses the query window to empty.
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Which shifts a branch runs (ordered by start). Resolution order:
 *  branch-specific override → global default → single FullDay. */
export async function getBranchShifts(branchId: string): Promise<ShiftLabel[]> {
  const supabase = await createAuditedClient();
  const { data: rows } = await supabase
    .from('settings').select('value, branch_id').eq('key', SETTING_KEY)
    .or(`branch_id.eq.${branchId},branch_id.is.null`);
  const value = (rows ?? []).find((r) => r.branch_id === branchId)?.value
    ?? (rows ?? []).find((r) => r.branch_id === null)?.value;
  const raw = value?.split(',').map((s) => s.trim()).filter(Boolean) as ShiftLabel[] | undefined;
  const valid = (raw ?? []).filter((s) => SHIFT_LABELS.includes(s));
  const shifts = valid.length ? valid : (['FullDay'] as ShiftLabel[]);
  return shifts.sort((a, b) => SHIFT_ORDER[a] - SHIFT_ORDER[b]);
}

/** A branch's shift cut points → per-label [start, end) windows.
 *  Resolution: branch override → global default → built-in 14:00 / 18:00. */
export async function getBranchShiftWindows(branchId: string): Promise<Record<ShiftLabel, [number, number]>> {
  const supabase = await createAuditedClient();
  const { data: rows } = await supabase
    .from('settings').select('value, branch_id').eq('key', CASH_WINDOWS_SETTING_KEY)
    .or(`branch_id.eq.${branchId},branch_id.is.null`);
  const value = (rows ?? []).find((r) => r.branch_id === branchId)?.value
    ?? (rows ?? []).find((r) => r.branch_id === null)?.value;
  const [c1, c2] = (value ?? '').split(',').map((s) => hhmmToMin(s));
  if (c1 != null && c2 != null && c1 > 0 && c1 < c2 && c2 < 1440) return buildWindows(c1, c2);
  return buildWindows(DEFAULT_AM_PM_CUT, DEFAULT_PM_NIGHT_CUT);
}

/** Save the AM→PM / PM→Night cut points. branchId=null sets the global default;
 *  a branchId writes an override for just that branch. */
export async function setCashShiftWindows(input: { am_pm_cut: string; pm_night_cut: string; branchId: string | null }): Promise<ActionResult> {
  if (!isAdmin(await currentSession())) return { ok: false, error: 'Admin permission required' };
  const c1 = hhmmToMin(input.am_pm_cut);
  const c2 = hhmmToMin(input.pm_night_cut);
  if (c1 == null || c2 == null) return { ok: false, error: 'Enter valid times' };
  if (!(c1 > 0 && c1 < c2 && c2 < 1440)) return { ok: false, error: 'AM→PM must be before PM→Night, both within the day' };
  const supabase = await createAuditedClient();
  const value = `${minToHHMM(c1)},${minToHHMM(c2)}`;

  if (input.branchId) {
    const { error } = await supabase.from('settings').upsert(
      { key: CASH_WINDOWS_SETTING_KEY, branch_id: input.branchId, scope: 'branch', value, value_type: 'string', description: 'Cash shift window cut points (branch override)' },
      { onConflict: 'key,branch_id' },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { data: existing } = await supabase.from('settings').select('id').eq('key', CASH_WINDOWS_SETTING_KEY).is('branch_id', null).maybeSingle();
    const payload = { value, scope: 'global', value_type: 'string', description: 'Cash shift window cut points (all branches)' };
    const { error } = existing
      ? await supabase.from('settings').update(payload).eq('id', existing.id)
      : await supabase.from('settings').insert({ key: CASH_WINDOWS_SETTING_KEY, branch_id: null, ...payload });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/reconciliation/cash');
  return { ok: true };
}

/** Save the cash-recon shifts. branchId=null sets the global default for every
 *  branch; a branchId writes an override for just that branch. */
export async function setCashShifts(input: { shifts: string[]; branchId: string | null }): Promise<ActionResult> {
  if (!isAdmin(await currentSession())) return { ok: false, error: 'Admin permission required' };
  const valid = input.shifts.filter((s): s is ShiftLabel => (SHIFT_LABELS as readonly string[]).includes(s));
  if (valid.length === 0) return { ok: false, error: 'Pick at least one shift' };
  const supabase = await createAuditedClient();
  const value = valid.join(',');

  if (input.branchId) {
    const { error } = await supabase.from('settings').upsert(
      { key: SETTING_KEY, branch_id: input.branchId, scope: 'branch', value, value_type: 'string', description: 'Cash reconciliation shifts (branch override)' },
      { onConflict: 'key,branch_id' },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    // Global row has branch_id IS NULL; Postgres treats NULLs as distinct so
    // onConflict can't dedupe it — update the existing one or insert a new one.
    const { data: existing } = await supabase.from('settings').select('id').eq('key', SETTING_KEY).is('branch_id', null).maybeSingle();
    const payload = { value, scope: 'global', value_type: 'string', description: 'Cash reconciliation shifts (all branches)' };
    const { error } = existing
      ? await supabase.from('settings').update(payload).eq('id', existing.id)
      : await supabase.from('settings').insert({ key: SETTING_KEY, branch_id: null, ...payload });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/reconciliation/cash');
  return { ok: true };
}

/** Cash received during a shift window on a date (by payment time, PHT). Counts
 * both counter payments (orders) and third-party AR collections taken in cash —
 * both physically land in the till. */
async function cashReceivedCents(branchId: string, date: string, win: [number, number]): Promise<number> {
  const supabase = await createAuditedClient();
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const [ws, we] = win;
  const from = `${date}T00:00:00+08:00`;
  const to = `${nextDate(date)}T00:00:00+08:00`;
  const inWindow = (iso: string) => { const mod = minuteOfDayPHT(iso); return mod >= ws && mod < we; };

  // Counter cash on orders for this branch.
  const { data: counter } = await supabase
    .from('payments')
    .select('amount_cents, paid_at, method:payment_methods!payments_payment_method_id_fkey ( code ), order:orders!payments_order_id_fkey ( branch_id, status )')
    .gte('paid_at', from)
    .lt('paid_at', to);
  const counterCash = (counter ?? [])
    .filter((p) => {
      const ord = one(p.order); const m = one(p.method);
      return !!ord && ord.branch_id === branchId && ord.status !== 'void' && m?.code === 'cash' && inWindow(p.paid_at);
    })
    .reduce((s, p) => s + p.amount_cents, 0);

  // AR (third-party) cash collected against this branch's statements.
  const { data: arPays } = await supabase
    .from('revenue_soa_payments')
    .select('amount_cents, paid_at, payment_method, soa:revenue_soa ( branch_id )')
    .gte('paid_at', from)
    .lt('paid_at', to);
  const arCash = (arPays ?? [])
    .filter((p) => {
      const soa = one(p.soa);
      return !!soa && soa.branch_id === branchId && (p.payment_method ?? '').toLowerCase() === 'cash' && inWindow(p.paid_at);
    })
    .reduce((s, p) => s + p.amount_cents, 0);

  return counterCash + arCash;
}

/** Per-shift status for a branch/day, with opening float inherited from the
 * previous closed shift. */
export async function loadDayShifts(branchId: string, date: string): Promise<ShiftStatus[]> {
  const supabase = await createAuditedClient();
  const shifts = await getBranchShifts(branchId);
  const windows = await getBranchShiftWindows(branchId);
  const { data: rows } = await supabase
    .from('cash_reconciliations')
    .select('shift_label, closing_count_cents, variance_cents, variance_reason, status')
    .eq('branch_id', branchId).eq('reconciliation_date', date);
  const closedByLabel = new Map((rows ?? []).filter((r) => r.status === 'closed').map((r) => [r.shift_label, r]));

  const out: ShiftStatus[] = [];
  let prevClosing = 0;
  for (const label of shifts) {
    const win = windows[label];
    const received = await cashReceivedCents(branchId, date, win);
    const opening = label === 'FullDay' ? 0 : prevClosing;
    const row = closedByLabel.get(label);
    out.push({
      label, windowLabel: formatWindow(label, win),
      openingCents: opening, receivedCents: received, expectedCents: opening + received,
      closed: row ? { actualCents: row.closing_count_cents ?? 0, varianceCents: row.variance_cents ?? 0, reason: row.variance_reason } : null,
    });
    if (row) prevClosing = row.closing_count_cents ?? 0;
  }
  return out;
}

/** True when every shift the branch runs is closed for that day. */
export async function isDayCashClosed(branchId: string, date: string): Promise<boolean> {
  const shifts = await loadDayShifts(branchId, date);
  return shifts.length > 0 && shifts.every((s) => s.closed);
}

const schema = z.object({
  branch_id: z.string().uuid(),
  date: z.string().min(1),
  shift_label: z.enum(SHIFT_LABELS),
  actual_count: z.coerce.number().min(0),
  variance_reason: z.string().max(300).optional().nullable(),
});

const reopenSchema = z.object({
  branch_id: z.string().uuid(),
  date: z.string().min(1),
  shift_label: z.enum(SHIFT_LABELS),
  reason: z.string().min(3, 'A reason is required').max(300),
});

// Reopen a closed shift (cash came in after counting, miscounted, etc.). Manager
// only; sets status back to 'open' so it can be recounted, keeping an audit trail.
export async function reopenCashReconciliation(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required to reopen' };
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const { error } = await supabase
    .from('cash_reconciliations')
    .update({
      status: 'open',
      reopened_at: new Date().toISOString(),
      reopened_by_staff_id: session!.staffUserId,
      reopen_reason: d.reason.trim(),
    })
    .eq('branch_id', d.branch_id)
    .eq('reconciliation_date', d.date)
    .eq('shift_label', d.shift_label)
    .eq('status', 'closed');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation/revenue-confirm');
  return { ok: true };
}

export async function closeCashReconciliation(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  if (!(await canAccessBranch(d.branch_id))) return { ok: false, error: 'No access to this branch' };

  const all = await loadDayShifts(d.branch_id, d.date);
  const shift = all.find((s) => s.label === d.shift_label);
  if (!shift) return { ok: false, error: 'This shift is not configured for the branch' };

  const actual = Math.round(d.actual_count * 100);
  const variance = actual - shift.expectedCents;
  if (variance !== 0 && (!d.variance_reason || d.variance_reason.trim().length < 3)) {
    return { ok: false, error: 'A variance reason is required when the count does not match' };
  }

  const supabase = await createAuditedClient();
  const { error } = await supabase.from('cash_reconciliations').upsert(
    {
      branch_id: d.branch_id, reconciliation_date: d.date, shift_label: d.shift_label,
      cashier_user_id: session!.staffUserId,
      opening_float_cents: shift.openingCents, previous_shift_handover_cents: shift.openingCents,
      system_cash_in_cents: shift.receivedCents, system_cash_out_cents: 0,
      system_expected_cents: shift.expectedCents,
      closing_count_cents: actual, actual_received_cents: actual,
      variance_cents: variance, variance_reason: variance !== 0 ? d.variance_reason?.trim() ?? null : null,
      status: 'closed', counted_by_staff_id: session!.staffUserId, closed_at: new Date().toISOString(),
    },
    { onConflict: 'branch_id,reconciliation_date,shift_label,cashier_user_id' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation/revenue-confirm');
  return { ok: true };
}
