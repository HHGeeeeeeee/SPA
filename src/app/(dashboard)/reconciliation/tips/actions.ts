'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface OpenTip {
  id: string;
  amount_cents: number;
  therapist_id: string;
  therapist_name: string;
  service_date: string;
}

/** Open (unsettled) PAYMAYA tips whose order falls in the period. */
export async function loadOpenTips(from: string, to: string): Promise<OpenTip[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tips')
    .select(`
      id, amount_cents, therapist_id, status, settlement_id,
      therapist:employees!tips_therapist_id_fkey ( name ),
      order:orders!tips_order_id_fkey ( service_date, status )
    `)
    .is('settlement_id', null)
    .eq('status', 'open');
  return (data ?? [])
    .map((t) => {
      const ord = one(t.order);
      const th = one(t.therapist);
      return {
        id: t.id,
        amount_cents: t.amount_cents,
        therapist_id: t.therapist_id,
        therapist_name: th?.name ?? '—',
        service_date: ord?.service_date ?? '',
        status: ord?.status ?? '',
      };
    })
    .filter((t) => t.service_date >= from && t.service_date <= to && t.status !== 'void')
    .map(({ status: _status, ...t }) => t);
}

const createSchema = z.object({ period_from: z.string().min(1), period_to: z.string().min(1) });

export async function createTipSettlement(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { period_from, period_to } = parsed.data;
  if (period_to < period_from) return { ok: false, error: 'End date must be on/after start date' };

  const tips = await loadOpenTips(period_from, period_to);
  if (tips.length === 0) return { ok: false, error: 'No open tips in this range' };
  const subtotal = tips.reduce((s, t) => s + t.amount_cents, 0);

  const supabase = createServiceClient();
  const ym = period_from.replace(/-/g, '').slice(0, 6);
  const prefix = `TS-${ym}-`;
  const { data: last } = await supabase
    .from('tip_settlements').select('settlement_no').like('settlement_no', `${prefix}%`).order('settlement_no', { ascending: false }).limit(1);
  const seq = last?.[0]?.settlement_no ? Number(last[0].settlement_no.slice(prefix.length)) : 0;
  const settlement_no = `${prefix}${String(seq + 1).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('tip_settlements')
    .insert({ settlement_no, period_from, period_to, subtotal_cents: subtotal, status: 'draft' })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create settlement' };

  revalidatePath('/reconciliation/tips');
  return { ok: true, data: { id: data.id } };
}

export async function confirmTipSettlement(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const { data: s } = await supabase.from('tip_settlements').select('period_from, period_to, status').eq('id', id).single();
  if (!s) return { ok: false, error: 'Settlement not found' };
  if (s.status !== 'draft') return { ok: false, error: 'Only draft settlements can be confirmed' };

  // NOTE: ERP/AP posting deferred — this only closes the tips for now.
  const tips = await loadOpenTips(s.period_from, s.period_to);
  const ids = tips.map((t) => t.id);
  if (ids.length > 0) {
    const { error } = await supabase.from('tips').update({ settlement_id: id, status: 'closed' }).in('id', ids);
    if (error) return { ok: false, error: error.message };
  }
  const { error: se } = await supabase
    .from('tip_settlements')
    .update({ status: 'closed', posted_at: new Date().toISOString() })
    .eq('id', id);
  if (se) return { ok: false, error: se.message };

  revalidatePath('/reconciliation/tips');
  return { ok: true };
}

export async function voidTipSettlement(id: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  await supabase.from('tips').update({ settlement_id: null, status: 'open' }).eq('settlement_id', id);
  const { error } = await supabase.from('tip_settlements').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/reconciliation/tips');
  return { ok: true };
}
