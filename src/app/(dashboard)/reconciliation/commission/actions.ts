'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertNoBlockedClose } from '@/lib/business-day';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface CommItemLine {
  item_id: string;
  service_date: string;
  order_no: string;
  service: string;
  duration_minutes: number | null;
  occurrence: number;
  warmup: boolean;
  gross_cents: number;
  rate: number;
  commission_cents: number;
}
export interface CommGroup {
  therapist_id: string;
  therapist_name: string;
  sessions: number;
  gross_cents: number;
  commission_cents: number;
  // When the therapist's home branch ≠ the settling branch, they were
  // borrowed for this period — surface the home code so manager sees who's
  // a loaner without cross-referencing the roster. null = same branch.
  borrowed_from: string | null;
  items: CommItemLine[];
}

// Eligible order_items at a branch: parent order paid/closed, within range, the
// service was actually completed (service_completed — so switched / interrupted /
// cancelled / no_show lines earn nothing, matching tip rules), has a therapist,
// the service is commission-applicable, and not yet settled.
async function loadEligible(from: string, to: string, branchId: string) {
  const supabase = await createAuditedClient();
  const { data, error } = await supabase
    .from('order_items')
    .select(`
      id, list_price_cents, duration_minutes, actual_start, created_at, therapist_id, therapist_home_branch_id, commission_settlement_id, status,
      service:service_items!order_items_service_item_id_fkey ( name, commission_applicable ),
      therapist:employees!order_items_therapist_id_fkey ( name ),
      order:orders!order_items_order_id_fkey ( order_no, status, service_date, branch_id )
    `)
    .is('commission_settlement_id', null)
    .not('therapist_id', 'is', null);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((it) => ({ it, ord: one(it.order), svc: one(it.service), th: one(it.therapist) }))
    .filter((r) =>
      r.ord && r.ord.branch_id === branchId && r.ord.status === 'closed' &&
      r.it.status === 'service_completed' &&
      r.ord.service_date >= from && r.ord.service_date <= to &&
      r.svc?.commission_applicable && r.it.therapist_id,
    );
}

// The commission engine (read-only): groups eligible items per therapist with
// per-line commission. commission = gross × effective_rate, where the effective
// rate is the warm-up band rate for the day's Nth session (by actual_start), else
// the therapist's class rate (branch override → global). No DB writes.
async function computeGroups(branchId: string, from: string, to: string): Promise<CommGroup[]> {
  const supabase = await createAuditedClient();
  const eligible = await loadEligible(from, to, branchId);
  if (eligible.length === 0) return [];

  const therapistIds = [...new Set(eligible.map((r) => r.it.therapist_id as string))];
  const [emps, classes, brates, br, allBranches] = await Promise.all([
    supabase.from('employees').select('id, commission_class_id').in('id', therapistIds),
    supabase.from('commission_classes').select('id, commission_rate'),
    supabase.from('branch_commission_rates').select('commission_class_id, commission_rate').eq('branch_id', branchId),
    supabase.from('branches').select('commission_policy_id').eq('id', branchId).maybeSingle(),
    // Branch id → code lookup for the borrowed-from badge. Loaded once
    // because the workspace can list ≤ ~dozen therapists, many borrowed
    // from a small set of branches — one fetch is cheaper than per-group.
    supabase.from('branches').select('id, code'),
  ]);
  const branchCode = new Map((allBranches.data ?? []).map((b) => [b.id as string, b.code as string]));
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

  const groups = new Map<string, CommGroup>();
  for (const [, rows] of byDay) {
    rows.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const occurrence = idx + 1;
      const classRate = resolveRate(r.it.therapist_id as string);
      const warm = warmupEnabled && occurrence === warmupOccurrence ? warmupRate(r.it.duration_minutes ?? 0) : null;
      const effRate = warm != null ? warm : classRate;
      const commission = Math.round((r.it.list_price_cents ?? 0) * effRate);
      const tid = r.it.therapist_id as string;
      const g = groups.get(tid) ?? { therapist_id: tid, therapist_name: r.th?.name ?? '—', sessions: 0, gross_cents: 0, commission_cents: 0, borrowed_from: null, items: [] };
      g.sessions += 1;
      g.gross_cents += (r.it.list_price_cents ?? 0);
      g.commission_cents += commission;
      // Borrowed-from: snapshot on the item; once set on the group, leave it
      // (a therapist has one home at a time, all line snapshots agree).
      if (g.borrowed_from === null && r.it.therapist_home_branch_id && r.it.therapist_home_branch_id !== branchId) {
        g.borrowed_from = branchCode.get(r.it.therapist_home_branch_id) ?? null;
      }
      g.items.push({
        item_id: r.it.id,
        service_date: r.ord!.service_date,
        order_no: r.ord!.order_no,
        service: r.svc?.name ?? 'Service',
        duration_minutes: r.it.duration_minutes ?? null,
        occurrence,
        warmup: warm != null,
        gross_cents: (r.it.list_price_cents ?? 0),
        rate: effRate,
        commission_cents: commission,
      });
      groups.set(tid, g);
    }
  }
  for (const g of groups.values()) g.items.sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
  return [...groups.values()].sort((a, b) => b.commission_cents - a.commission_cents);
}

/** Per-therapist commission for unsettled items in range — drives the workspace. */
export async function loadCommissionGroups(branchId: string, from: string, to: string): Promise<CommGroup[]> {
  return computeGroups(branchId, from, to);
}

const settleSchema = z.object({
  branch_id: z.string().uuid(),
  from: z.string().min(1),
  to: z.string().min(1),
  therapist_ids: z.array(z.string().uuid()).min(1),
});

/** Settle the selected therapists' commission into one period (closed). */
export async function settleCommission(input: unknown): Promise<ActionResult<{ id: string; therapists: number }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { branch_id, from, to, therapist_ids } = parsed.data;
  if (to < from) return { ok: false, error: 'End date must be on/after start date' };
  if (!(await canAccessBranch(branch_id))) return { ok: false, error: 'No access to this branch' };
  try { await assertNoBlockedClose(branch_id); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const selectedSet = new Set(therapist_ids);
  const groups = (await computeGroups(branch_id, from, to)).filter((g) => selectedSet.has(g.therapist_id));
  if (groups.length === 0) return { ok: false, error: 'No eligible commission for the selection' };

  const supabase = await createAuditedClient();
  const { data: branch } = await supabase.from('branches').select('code').eq('id', branch_id).single();
  const ym = from.replace(/-/g, '').slice(0, 6);
  const prefix = `CP-${branch?.code ?? 'X'}-${ym}-`;
  const { data: last } = await supabase
    .from('commission_periods').select('period_no').like('period_no', `${prefix}%`).order('period_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.period_no ? Number(last[0].period_no.slice(prefix.length)) : 0;
  const period_no = `${prefix}${String(seq + 1).padStart(2, '0')}`;

  const totals = groups.reduce(
    (acc, g) => ({ sessions: acc.sessions + g.sessions, gross: acc.gross + g.gross_cents, commission: acc.commission + g.commission_cents }),
    { sessions: 0, gross: 0, commission: 0 },
  );

  const { data: period, error: pe } = await supabase
    .from('commission_periods')
    .insert({
      period_no, branch_id, period_from: from, period_to: to, status: 'closed', confirmed_at: new Date().toISOString(),
      total_sessions: totals.sessions, total_gross_sales_cents: totals.gross, total_commission_cents: totals.commission,
    })
    .select('id')
    .single();
  if (pe || !period) return { ok: false, error: pe?.message ?? 'Could not create period' };

  const { error: ee } = await supabase.from('commission_entries').insert(groups.map((g) => ({
    period_id: period.id, therapist_id: g.therapist_id, branch_id,
    total_sessions: g.sessions, total_gross_sales_cents: g.gross_cents,
    computed_commission_cents: g.commission_cents, adjustment_cents: 0, final_amount_cents: g.commission_cents,
  })));
  if (ee) return { ok: false, error: ee.message };

  // Persist per-line commission and stamp the items as settled.
  for (const g of groups) {
    for (const it of g.items) {
      await supabase.from('order_items').update({
        commission_amount_cents: it.commission_cents,
        commission_rate: it.rate,
        commission_branch_id: branch_id,
        commission_settlement_id: period.id,
      }).eq('id', it.item_id);
    }
  }

  revalidatePath('/reconciliation/commission');
  return { ok: true, data: { id: period.id, therapists: groups.length } };
}

export async function voidCommissionPeriod(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = await createAuditedClient();
  await supabase.from('order_items').update({ commission_settlement_id: null }).eq('commission_settlement_id', id);
  const { error } = await supabase.from('commission_periods').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/commission');
  return { ok: true };
}
