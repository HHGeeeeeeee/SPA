'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireAdmin } from '@/lib/auth';

type BillingUpdate = Database['public']['Tables']['billing_destinations']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  settlement_type: z.enum(['intercompany', 'third_party']),
  // The single transaction code that drives BOTH the AR booking (掛帳) line and
  // the settle line — it carries its own DR/CR (and DR/CR branches), so one code
  // per destination is enough. Supersedes the old intercompany_account/sub GL.
  transaction_code_id: z.string().uuid().optional().nullable(),
  default_payment_method_id: z.string().uuid().optional().nullable(),
  credit_terms_days: z.coerce.number().int().min(0).max(365).default(30),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createBillingDestination(input: unknown): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('billing_destinations').insert({
    code: parsed.data.code,
    name: parsed.data.name,
    settlement_type: parsed.data.settlement_type,
    transaction_code_id: parsed.data.transaction_code_id || null,
    default_payment_method_id: parsed.data.default_payment_method_id || null,
    credit_terms_days: parsed.data.credit_terms_days,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/billing-destinations');
  return { ok: true };
}

export async function updateBillingDestination(input: unknown): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: BillingUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.settlement_type !== undefined) patch.settlement_type = d.settlement_type;
  if (d.transaction_code_id !== undefined) patch.transaction_code_id = d.transaction_code_id || null;
  if (d.default_payment_method_id !== undefined)
    patch.default_payment_method_id = d.default_payment_method_id || null;
  if (d.credit_terms_days !== undefined) patch.credit_terms_days = d.credit_terms_days;
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('billing_destinations').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/billing-destinations');
  return { ok: true };
}

export async function setBillingDestinationActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('billing_destinations').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/billing-destinations');
  return { ok: true };
}
