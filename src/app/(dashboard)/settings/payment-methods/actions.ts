'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireAdminOrAccountant } from '@/lib/auth';

type PaymentMethodUpdate = Database['public']['Tables']['payment_methods']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  display_name: z.string().min(1).max(80),
  currency: z.string().min(3).max(3).default('PHP'),
  method_type: z.enum(['one_time', 'recurring', 'stored_value', 'prepaid_quota']).default('one_time'),
  manual_reconciliation: z.boolean().default(true),
  requires_reference: z.boolean().default(false),
  // The GL transaction code every payment/refund taken with this method posts
  // under (AR and stored-value redemptions resolve elsewhere).
  transaction_code_id: z.string().uuid().optional().nullable(),
});

const updateSchema = schema.partial().extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createPaymentMethod(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('payment_methods').insert({ ...parsed.data, transaction_code_id: parsed.data.transaction_code_id || null, active: true });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/payment-methods');
  return { ok: true };
}

export async function updatePaymentMethod(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: PaymentMethodUpdate = {};
  if (d.display_name !== undefined) patch.display_name = d.display_name;
  if (d.currency !== undefined) patch.currency = d.currency;
  if (d.method_type !== undefined) patch.method_type = d.method_type;
  if (d.manual_reconciliation !== undefined) patch.manual_reconciliation = d.manual_reconciliation;
  if (d.requires_reference !== undefined) patch.requires_reference = d.requires_reference;
  if (d.transaction_code_id !== undefined) patch.transaction_code_id = d.transaction_code_id || null;
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('payment_methods').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/payment-methods');
  return { ok: true };
}

export async function setPaymentMethodActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('payment_methods').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/payment-methods');
  return { ok: true };
}
