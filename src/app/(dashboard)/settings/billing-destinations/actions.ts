'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type BillingUpdate = Database['public']['Tables']['billing_destinations']['Update'];

const noDash = z.string().regex(/^[^-]*$/, 'Cannot contain "-" (Acumatica constraint)');

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  settlement_type: z.enum(['intercompany', 'third_party']),
  intercompany_account: z.string().max(20).optional().nullable().or(z.literal('')),
  intercompany_sub: noDash.max(20).optional().nullable().or(z.literal('')),
  default_payment_method_id: z.string().uuid().optional().nullable(),
  credit_terms_days: z.coerce.number().int().min(0).max(365).default(30),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createBillingDestination(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('billing_destinations').insert({
    code: parsed.data.code,
    name: parsed.data.name,
    settlement_type: parsed.data.settlement_type,
    intercompany_account: parsed.data.intercompany_account || null,
    intercompany_sub: parsed.data.intercompany_sub || null,
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
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: BillingUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.settlement_type !== undefined) patch.settlement_type = d.settlement_type;
  if (d.intercompany_account !== undefined) patch.intercompany_account = d.intercompany_account || null;
  if (d.intercompany_sub !== undefined) patch.intercompany_sub = d.intercompany_sub || null;
  if (d.default_payment_method_id !== undefined)
    patch.default_payment_method_id = d.default_payment_method_id || null;
  if (d.credit_terms_days !== undefined) patch.credit_terms_days = d.credit_terms_days;
  const supabase = createServiceClient();
  const { error } = await supabase.from('billing_destinations').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/billing-destinations');
  return { ok: true };
}

export async function setBillingDestinationActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('billing_destinations').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/billing-destinations');
  return { ok: true };
}
