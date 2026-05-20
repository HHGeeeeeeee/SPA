'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';

export type ActionResult = { ok: true } | { ok: false; error: string };

const SHIFT_LABEL = 'FullDay';

const schema = z.object({
  branch_id: z.string().uuid(),
  date: z.string().min(1),
  actual_count: z.coerce.number().min(0),
  variance_reason: z.string().max(300).optional().nullable(),
});

/** Sum of cash-method payments for a branch on a service date (in cents). */
export async function expectedCashCents(branchId: string, date: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('payments')
    .select('amount_cents, method:payment_methods!payments_payment_method_id_fkey ( code ), order:orders!payments_order_id_fkey ( branch_id, service_date, status )')
    .eq('order.branch_id', branchId)
    .eq('order.service_date', date);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return (data ?? [])
    .filter((p) => {
      const ord = one(p.order);
      const m = one(p.method);
      return ord && ord.status !== 'void' && m?.code === 'cash';
    })
    .reduce((s, p) => s + p.amount_cents, 0);
}

export async function closeCashReconciliation(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const expected = await expectedCashCents(d.branch_id, d.date);
  const actual = Math.round(d.actual_count * 100);
  const variance = actual - expected;
  if (variance !== 0 && (!d.variance_reason || d.variance_reason.trim().length < 3)) {
    return { ok: false, error: 'A variance reason is required when the count does not match' };
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('cash_reconciliations').upsert(
    {
      branch_id: d.branch_id,
      reconciliation_date: d.date,
      shift_label: SHIFT_LABEL,
      cashier_user_id: session!.staffUserId,
      opening_float_cents: 0,
      previous_shift_handover_cents: 0,
      system_cash_in_cents: expected,
      system_cash_out_cents: 0,
      system_expected_cents: expected,
      closing_count_cents: actual,
      actual_received_cents: actual,
      variance_cents: variance,
      variance_reason: variance !== 0 ? d.variance_reason?.trim() ?? null : null,
      status: 'closed',
      counted_by_staff_id: session!.staffUserId,
      closed_at: now,
    },
    { onConflict: 'branch_id,reconciliation_date,shift_label,cashier_user_id' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/cash');
  revalidatePath('/reconciliation/revenue-confirm');
  return { ok: true };
}
