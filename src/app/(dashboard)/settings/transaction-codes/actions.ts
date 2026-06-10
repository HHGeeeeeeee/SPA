'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireAdminOrAccountant } from '@/lib/auth';

type TxCodeUpdate = Database['public']['Tables']['transaction_codes']['Update'];

const noDash = z.string().regex(/^[^-]*$/, 'Cannot contain "-" (Acumatica constraint)');

const baseSchema = z.object({
  code: z.string().min(1).max(60),
  // Revenue codes follow the order, not the store, so they're branchless; every
  // other type is branch-scoped. The required-branch rule is enforced below.
  branch_id: z.string().uuid().optional().nullable(),
  transaction_type: z.enum(['payment', 'settle', 'cost', 'adjust', 'revenue']),
  payment_method_id: z.string().uuid().optional().nullable(),
  debit_account: z.string().max(20).optional().nullable().or(z.literal('')),
  debit_subaccount: noDash.max(20).optional().nullable().or(z.literal('')),
  // Free-text Acumatica branch segment override (empty = use header branch).
  debit_branch_id: z.string().max(30).optional().nullable().or(z.literal('')),
  credit_account: z.string().max(20).optional().nullable().or(z.literal('')),
  credit_subaccount: noDash.max(20).optional().nullable().or(z.literal('')),
  credit_branch_id: z.string().max(30).optional().nullable().or(z.literal('')),
});

const schema = baseSchema.superRefine((d, ctx) => {
  if (d.transaction_type !== 'revenue' && !d.branch_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Branch is required for this type', path: ['branch_id'] });
  }
});

const updateSchema = baseSchema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createTransactionCode(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('transaction_codes').insert({
    code: d.code,
    branch_id: d.branch_id || null,
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
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: TxCodeUpdate = {};
  if (d.branch_id !== undefined) patch.branch_id = d.branch_id || null;
  if (d.transaction_type !== undefined) patch.transaction_type = d.transaction_type;
  if (d.payment_method_id !== undefined) patch.payment_method_id = d.payment_method_id || null;
  if (d.debit_account !== undefined) patch.debit_account = d.debit_account || null;
  if (d.debit_subaccount !== undefined) patch.debit_subaccount = d.debit_subaccount || null;
  if (d.debit_branch_id !== undefined) patch.debit_branch_id = d.debit_branch_id || null;
  if (d.credit_account !== undefined) patch.credit_account = d.credit_account || null;
  if (d.credit_subaccount !== undefined) patch.credit_subaccount = d.credit_subaccount || null;
  if (d.credit_branch_id !== undefined) patch.credit_branch_id = d.credit_branch_id || null;
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('transaction_codes').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/transaction-codes');
  return { ok: true };
}

export async function setTransactionCodeActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('transaction_codes').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/transaction-codes');
  return { ok: true };
}
