'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

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

  const supabase = await createAuditedClient();
  const { data: rows } = await supabase
    .from('tips')
    .select('id, amount_cents, status, settlement_id, order:orders!tips_order_id_fkey ( service_date, branch_id )')
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

  revalidatePath('/reconciliation/tips');
  return { ok: true, data: { id: settlement.id, count: valid.length } };
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
