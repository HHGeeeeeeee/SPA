'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type PaymentMethodUpdate = Database['public']['Tables']['payment_methods']['Update'];

const noDash = z.string().regex(/^[^-]*$/, 'Cannot contain "-" (Acumatica constraint)');

const schema = z.object({
  code: z.string().min(1).max(40),
  display_name: z.string().min(1).max(80),
  currency: z.string().min(3).max(3).default('PHP'),
  method_type: z.enum(['one_time', 'recurring', 'stored_value', 'prepaid_quota']).default('one_time'),
  manual_reconciliation: z.boolean().default(true),
  requires_reference: z.boolean().default(false),
  debit_account: z.string().max(20).optional().nullable().or(z.literal('')),
  debit_subaccount: noDash.max(20).optional().nullable().or(z.literal('')),
  debit_branch: z.string().max(20).optional().nullable().or(z.literal('')),
  credit_account: z.string().max(20).optional().nullable().or(z.literal('')),
  credit_subaccount: noDash.max(20).optional().nullable().or(z.literal('')),
  credit_branch: z.string().max(20).optional().nullable().or(z.literal('')),
});

const updateSchema = schema.partial().extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

function normalize(d: z.infer<typeof schema>) {
  return {
    code: d.code,
    display_name: d.display_name,
    currency: d.currency,
    method_type: d.method_type,
    manual_reconciliation: d.manual_reconciliation,
    requires_reference: d.requires_reference,
    debit_account: d.debit_account || null,
    debit_subaccount: d.debit_subaccount || null,
    debit_branch: d.debit_branch || null,
    credit_account: d.credit_account || null,
    credit_subaccount: d.credit_subaccount || null,
    credit_branch: d.credit_branch || null,
  };
}

export async function createPaymentMethod(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('payment_methods').insert({ ...normalize(parsed.data), active: true });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/payment-methods');
  return { ok: true };
}

export async function updatePaymentMethod(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: PaymentMethodUpdate = {};
  if (d.display_name !== undefined) patch.display_name = d.display_name;
  if (d.currency !== undefined) patch.currency = d.currency;
  if (d.method_type !== undefined) patch.method_type = d.method_type;
  if (d.manual_reconciliation !== undefined) patch.manual_reconciliation = d.manual_reconciliation;
  if (d.requires_reference !== undefined) patch.requires_reference = d.requires_reference;
  if (d.debit_account !== undefined) patch.debit_account = d.debit_account || null;
  if (d.debit_subaccount !== undefined) patch.debit_subaccount = d.debit_subaccount || null;
  if (d.debit_branch !== undefined) patch.debit_branch = d.debit_branch || null;
  if (d.credit_account !== undefined) patch.credit_account = d.credit_account || null;
  if (d.credit_subaccount !== undefined) patch.credit_subaccount = d.credit_subaccount || null;
  if (d.credit_branch !== undefined) patch.credit_branch = d.credit_branch || null;
  const supabase = createServiceClient();
  const { error } = await supabase.from('payment_methods').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/payment-methods');
  return { ok: true };
}

export async function setPaymentMethodActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('payment_methods').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/payment-methods');
  return { ok: true };
}
