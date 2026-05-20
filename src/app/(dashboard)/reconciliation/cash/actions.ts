'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager, isAdmin } from '@/lib/auth';
import { SHIFT_LABELS, WINDOW, CASH_SHIFTS_SETTING_KEY as SETTING_KEY, type ShiftLabel, type ShiftStatus } from './shifts';

export type ActionResult = { ok: true } | { ok: false; error: string };

function minuteOfDayPHT(iso: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
}
function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Which shifts a branch runs (ordered by start). Default: single FullDay. */
export async function getBranchShifts(branchId: string): Promise<ShiftLabel[]> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('settings').select('value').eq('key', SETTING_KEY).eq('branch_id', branchId).maybeSingle();
  const raw = data?.value?.split(',').map((s) => s.trim()).filter(Boolean) as ShiftLabel[] | undefined;
  const valid = (raw ?? []).filter((s) => SHIFT_LABELS.includes(s));
  const shifts = valid.length ? valid : (['FullDay'] as ShiftLabel[]);
  return shifts.sort((a, b) => WINDOW[a][0] - WINDOW[b][0]);
}

export async function setBranchShifts(branchId: string, shifts: string[]): Promise<ActionResult> {
  if (!isAdmin(await currentSession())) return { ok: false, error: 'Admin permission required' };
  const valid = shifts.filter((s): s is ShiftLabel => (SHIFT_LABELS as readonly string[]).includes(s));
  if (valid.length === 0) return { ok: false, error: 'Pick at least one shift' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('settings').upsert(
    { key: SETTING_KEY, branch_id: branchId, scope: 'branch', value: valid.join(','), value_type: 'string', description: 'Cash reconciliation shifts for this branch' },
    { onConflict: 'key,branch_id' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/cash');
  return { ok: true };
}

/** Cash received during a shift window on a date (by payment time, PHT). */
async function cashReceivedCents(branchId: string, date: string, label: ShiftLabel): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('payments')
    .select('amount_cents, paid_at, method:payment_methods!payments_payment_method_id_fkey ( code ), order:orders!payments_order_id_fkey ( branch_id, status )')
    .gte('paid_at', `${date}T00:00:00+08:00`)
    .lt('paid_at', `${nextDate(date)}T00:00:00+08:00`);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const [ws, we] = WINDOW[label];
  return (data ?? [])
    .filter((p) => {
      const ord = one(p.order); const m = one(p.method);
      if (!ord || ord.branch_id !== branchId || ord.status === 'void' || m?.code !== 'cash') return false;
      const mod = minuteOfDayPHT(p.paid_at);
      return mod >= ws && mod < we;
    })
    .reduce((s, p) => s + p.amount_cents, 0);
}

/** Per-shift status for a branch/day, with opening float inherited from the
 * previous closed shift. */
export async function loadDayShifts(branchId: string, date: string): Promise<ShiftStatus[]> {
  const supabase = createServiceClient();
  const shifts = await getBranchShifts(branchId);
  const { data: rows } = await supabase
    .from('cash_reconciliations')
    .select('shift_label, closing_count_cents, variance_cents, variance_reason, status')
    .eq('branch_id', branchId).eq('reconciliation_date', date);
  const closedByLabel = new Map((rows ?? []).filter((r) => r.status === 'closed').map((r) => [r.shift_label, r]));

  const out: ShiftStatus[] = [];
  let prevClosing = 0;
  for (const label of shifts) {
    const received = await cashReceivedCents(branchId, date, label);
    const opening = label === 'FullDay' ? 0 : prevClosing;
    const row = closedByLabel.get(label);
    out.push({
      label, openingCents: opening, receivedCents: received, expectedCents: opening + received,
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

export async function closeCashReconciliation(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const all = await loadDayShifts(d.branch_id, d.date);
  const shift = all.find((s) => s.label === d.shift_label);
  if (!shift) return { ok: false, error: 'This shift is not configured for the branch' };

  const actual = Math.round(d.actual_count * 100);
  const variance = actual - shift.expectedCents;
  if (variance !== 0 && (!d.variance_reason || d.variance_reason.trim().length < 3)) {
    return { ok: false, error: 'A variance reason is required when the count does not match' };
  }

  const supabase = createServiceClient();
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
