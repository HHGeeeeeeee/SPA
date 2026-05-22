'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const createSchema = z.object({
  branch_id: z.string().uuid(),
  period_from: z.string().min(1),
  period_to: z.string().min(1),
});

// Eligible order_items at a branch: parent order paid/closed, within range, has
// a therapist, the service is commission-applicable, and not yet settled.
async function loadEligible(from: string, to: string, branchId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('order_items')
    .select(`
      id, list_price_cents, duration_minutes, actual_start, created_at, therapist_id, commission_settlement_id, status,
      service:service_items!order_items_service_item_id_fkey ( commission_applicable ),
      order:orders!order_items_order_id_fkey ( status, service_date, branch_id )
    `)
    .is('commission_settlement_id', null)
    .not('therapist_id', 'is', null);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((it) => ({ it, ord: one(it.order), svc: one(it.service) }))
    .filter((r) =>
      r.ord && r.ord.branch_id === branchId && ['paid', 'closed'].includes(r.ord.status) &&
      r.it.status !== 'cancelled' &&
      r.ord.service_date >= from && r.ord.service_date <= to &&
      r.svc?.commission_applicable && r.it.therapist_id,
    );
}

type Entry = { therapist_id: string; branch_id: string; sessions: number; gross: number; commission: number };

// The commission engine. For a branch + period:
//   commission = gross × class_rate × warm-up_multiplier
//   - class_rate: the therapist's class at this branch (override → default),
//     resolved through one helper so a per-branch rate can be added later.
//   - warm-up_multiplier: the branch's commission policy applied to the day's
//     Nth session (by actual_start), bucketed by duration.
// Stores the computed commission back on each order_item, returns aggregated
// entries + the item ids touched.
async function computeCommission(branchId: string, from: string, to: string): Promise<{ entries: Entry[]; itemIds: string[] }> {
  const supabase = createServiceClient();
  const eligible = await loadEligible(from, to, branchId);
  if (eligible.length === 0) return { entries: [], itemIds: [] };

  const therapistIds = [...new Set(eligible.map((r) => r.it.therapist_id as string))];

  // The therapist's class (fixed) → its rate. The rate is per-branch: a branch
  // can override the % for a class, else the global commission_classes rate.
  const [emps, classes, brates, br] = await Promise.all([
    supabase.from('employees').select('id, commission_class_id').in('id', therapistIds),
    supabase.from('commission_classes').select('id, commission_rate'),
    supabase.from('branch_commission_rates').select('commission_class_id, commission_rate').eq('branch_id', branchId),
    supabase.from('branches').select('commission_policy_id').eq('id', branchId).maybeSingle(),
  ]);
  const defaultClass = new Map((emps.data ?? []).map((e) => [e.id, e.commission_class_id]));
  const globalRate = new Map((classes.data ?? []).map((c) => [c.id, c.commission_rate]));
  const branchRate = new Map((brates.data ?? []).map((r) => [r.commission_class_id, r.commission_rate]));
  const resolveRate = (therapistId: string): number => {
    const classId = defaultClass.get(therapistId) ?? null;
    if (!classId) return 0;
    return branchRate.get(classId) ?? globalRate.get(classId) ?? 0;
  };

  let warmupEnabled = false;
  let warmupOccurrence = 1;
  let bands: { min_minutes: number | null; up_to_minutes: number | null; commission_rate: number }[] = [];
  const policyId = br.data?.commission_policy_id ?? null;
  if (policyId) {
    const [p, b] = await Promise.all([
      supabase.from('commission_policies').select('warmup_enabled, warmup_occurrence').eq('id', policyId).maybeSingle(),
      supabase.from('commission_policy_bands').select('min_minutes, up_to_minutes, commission_rate').eq('policy_id', policyId).order('up_to_minutes', { nullsFirst: false }),
    ]);
    warmupEnabled = p.data?.warmup_enabled ?? false;
    warmupOccurrence = p.data?.warmup_occurrence ?? 1;
    bands = b.data ?? [];
  }
  // Absolute commission rate for a warm-up session of this duration (the warm-up
  // is a special flat rate, NOT a multiplier of the class rate). Range match by
  // min_minutes..up_to_minutes; null = no matching band → fall back to class.
  const warmupRate = (durationMin: number): number | null => {
    for (const band of bands) {
      const minOk = band.min_minutes == null || durationMin >= band.min_minutes;
      const maxOk = band.up_to_minutes == null || durationMin <= band.up_to_minutes;
      if (minOk && maxOk) return Number(band.commission_rate);
    }
    return null;
  };

  // Group per therapist + calendar day, order by actual_start to set occurrence.
  const byDay = new Map<string, typeof eligible>();
  for (const r of eligible) {
    const key = `${r.it.therapist_id}:${r.ord!.service_date}`;
    const arr = byDay.get(key);
    if (arr) arr.push(r); else byDay.set(key, [r]);
  }
  const sortKey = (r: (typeof eligible)[number]) => r.it.actual_start ?? r.it.created_at ?? '9999';

  const agg = new Map<string, Entry>();
  const itemIds: string[] = [];
  for (const [, rows] of byDay) {
    rows.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const occurrence = idx + 1;
      const classRate = resolveRate(r.it.therapist_id as string);
      // Warm-up session uses the band's absolute rate; otherwise the class rate.
      const warm = warmupEnabled && occurrence === warmupOccurrence ? warmupRate(r.it.duration_minutes ?? 0) : null;
      const effRate = warm != null ? warm : classRate;
      const commission = Math.round(r.it.list_price_cents * effRate);
      // Store the computed commission on the line.
      await supabase.from('order_items').update({
        commission_amount_cents: commission,
        commission_rate: effRate,
        commission_branch_id: branchId,
      }).eq('id', r.it.id);
      itemIds.push(r.it.id);
      const a = agg.get(r.it.therapist_id as string) ?? { therapist_id: r.it.therapist_id as string, branch_id: branchId, sessions: 0, gross: 0, commission: 0 };
      a.sessions += 1; a.gross += r.it.list_price_cents; a.commission += commission;
      agg.set(r.it.therapist_id as string, a);
    }
  }
  return { entries: [...agg.values()], itemIds };
}

export async function createCommissionPeriod(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { branch_id, period_from, period_to } = parsed.data;
  if (period_to < period_from) return { ok: false, error: 'End date must be on/after start date' };

  const { entries } = await computeCommission(branch_id, period_from, period_to);
  if (entries.length === 0) return { ok: false, error: 'No eligible commission items for this branch in this range' };

  const supabase = createServiceClient();
  const { data: branch } = await supabase.from('branches').select('code').eq('id', branch_id).single();
  const ymd = period_from.replace(/-/g, '').slice(0, 6);
  const prefix = `CP-${branch?.code ?? 'X'}-${ymd}-`;
  const { data: last } = await supabase
    .from('commission_periods').select('period_no').like('period_no', `${prefix}%`).order('period_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.period_no ? Number(last[0].period_no.slice(prefix.length)) : 0;
  const period_no = `${prefix}${String(seq + 1).padStart(2, '0')}`;

  const totals = entries.reduce(
    (acc, g) => ({ sessions: acc.sessions + g.sessions, gross: acc.gross + g.gross, commission: acc.commission + g.commission }),
    { sessions: 0, gross: 0, commission: 0 },
  );

  const { data: period, error: pe } = await supabase
    .from('commission_periods')
    .insert({
      period_no, branch_id, period_from, period_to, status: 'draft',
      total_sessions: totals.sessions,
      total_gross_sales_cents: totals.gross,
      total_commission_cents: totals.commission,
    })
    .select('id')
    .single();
  if (pe || !period) return { ok: false, error: pe?.message ?? 'Could not create period' };

  const { error: ee } = await supabase.from('commission_entries').insert(entries.map((g) => ({
    period_id: period.id,
    therapist_id: g.therapist_id,
    branch_id: g.branch_id,
    total_sessions: g.sessions,
    total_gross_sales_cents: g.gross,
    computed_commission_cents: g.commission,
    adjustment_cents: 0,
    final_amount_cents: g.commission,
  })));
  if (ee) return { ok: false, error: ee.message };

  revalidatePath('/reconciliation/commission');
  return { ok: true, data: { id: period.id } };
}

export async function confirmCommissionPeriod(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { data: period, error: pe } = await supabase
    .from('commission_periods').select('period_from, period_to, status, branch_id').eq('id', id).single();
  if (pe || !period) return { ok: false, error: 'Period not found' };
  if (period.status !== 'draft') return { ok: false, error: 'Only draft periods can be confirmed' };
  if (!period.branch_id) return { ok: false, error: 'Period has no branch' };

  // Recompute (refresh per-item commission + entries) then stamp + close.
  const { entries, itemIds } = await computeCommission(period.branch_id, period.period_from, period.period_to);
  const totals = entries.reduce(
    (acc, g) => ({ sessions: acc.sessions + g.sessions, gross: acc.gross + g.gross, commission: acc.commission + g.commission }),
    { sessions: 0, gross: 0, commission: 0 },
  );
  await supabase.from('commission_entries').delete().eq('period_id', id);
  if (entries.length > 0) {
    await supabase.from('commission_entries').insert(entries.map((g) => ({
      period_id: id, therapist_id: g.therapist_id, branch_id: g.branch_id,
      total_sessions: g.sessions, total_gross_sales_cents: g.gross,
      computed_commission_cents: g.commission, adjustment_cents: 0, final_amount_cents: g.commission,
    })));
  }
  await supabase.from('commission_periods').update({
    total_sessions: totals.sessions, total_gross_sales_cents: totals.gross, total_commission_cents: totals.commission,
  }).eq('id', id);

  if (itemIds.length > 0) {
    const { error: ue } = await supabase.from('order_items').update({ commission_settlement_id: id }).in('id', itemIds);
    if (ue) return { ok: false, error: ue.message };
  }
  const { error } = await supabase
    .from('commission_periods')
    .update({ status: 'closed', confirmed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/reconciliation/commission');
  return { ok: true };
}

export async function voidCommissionPeriod(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  // release any stamped items first
  await supabase.from('order_items').update({ commission_settlement_id: null }).eq('commission_settlement_id', id);
  const { error } = await supabase.from('commission_periods').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/commission');
  return { ok: true };
}
