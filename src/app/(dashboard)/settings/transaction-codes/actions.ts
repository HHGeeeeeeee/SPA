'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type TxCodeUpdate = Database['public']['Tables']['transaction_codes']['Update'];

const noDash = z.string().regex(/^[^-]*$/, 'Cannot contain "-" (Acumatica constraint)');

const schema = z.object({
  code: z.string().min(1).max(60),
  branch_id: z.string().uuid(),
  transaction_type: z.enum(['payment', 'settle', 'cost', 'adjust']),
  payment_method_id: z.string().uuid().optional().nullable(),
  debit_account: z.string().max(20).optional().nullable().or(z.literal('')),
  debit_subaccount: noDash.max(20).optional().nullable().or(z.literal('')),
  debit_branch_id: z.string().uuid().optional().nullable(),
  credit_account: z.string().max(20).optional().nullable().or(z.literal('')),
  credit_subaccount: noDash.max(20).optional().nullable().or(z.literal('')),
  credit_branch_id: z.string().uuid().optional().nullable(),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createTransactionCode(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = createServiceClient();
  const { error } = await supabase.from('transaction_codes').insert({
    code: d.code,
    branch_id: d.branch_id,
    transaction_type: d.transaction_type,
    payment_method_id: d.payment_method_id || null,
    debit_account: d.debit_account || null,
    debit_subaccount: d.debit_subaccount || null,
    debit_branch_id: d.debit_branch_id || null,
    credit_account: d.credit_account || null,
    credit_subaccount: d.credit_subaccount || null,
    credit_branch_id: d.credit_branch_id || null,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${d.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/transaction-codes');
  return { ok: true };
}

export async function updateTransactionCode(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: TxCodeUpdate = {};
  if (d.branch_id !== undefined) patch.branch_id = d.branch_id;
  if (d.transaction_type !== undefined) patch.transaction_type = d.transaction_type;
  if (d.payment_method_id !== undefined) patch.payment_method_id = d.payment_method_id || null;
  if (d.debit_account !== undefined) patch.debit_account = d.debit_account || null;
  if (d.debit_subaccount !== undefined) patch.debit_subaccount = d.debit_subaccount || null;
  if (d.debit_branch_id !== undefined) patch.debit_branch_id = d.debit_branch_id || null;
  if (d.credit_account !== undefined) patch.credit_account = d.credit_account || null;
  if (d.credit_subaccount !== undefined) patch.credit_subaccount = d.credit_subaccount || null;
  if (d.credit_branch_id !== undefined) patch.credit_branch_id = d.credit_branch_id || null;
  const supabase = createServiceClient();
  const { error } = await supabase.from('transaction_codes').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/transaction-codes');
  return { ok: true };
}

export async function setTransactionCodeActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('transaction_codes').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/transaction-codes');
  return { ok: true };
}
