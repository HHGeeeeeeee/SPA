'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireManager } from '@/lib/auth';

type SourceUpdate = Database['public']['Tables']['customer_sources']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  default_billing_to_id: z.string().uuid().optional().nullable(),
  default_discount_class_id: z.string().uuid().optional().nullable(),
  discount_locked: z.boolean().optional(),
  phone_required: z.boolean().optional(),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

// A locked (group) source must use a fixed-rate discount. Manual/variable
// discounts (DIS-91/DIS-99) need a per-item amount, which contradicts a single
// locked rate — so reject that combination.
const VARIABLE_DISCOUNT_CODES = ['DIS-91', 'DIS-99'];
async function variableLockError(
  locked: boolean | undefined,
  defaultDiscountId: string | null | undefined,
): Promise<string | null> {
  if (!locked || !defaultDiscountId) return null;
  const supabase = await createAuditedClient();
  const { data } = await supabase.from('discount_classes').select('code').eq('id', defaultDiscountId).maybeSingle();
  if (data && VARIABLE_DISCOUNT_CODES.includes(data.code)) {
    return `${data.code} is a manual/variable discount and can't be a locked group rate. Pick a fixed-rate discount, or turn off Lock.`;
  }
  return null;
}

export async function createCustomerSource(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const lockErr = await variableLockError(parsed.data.discount_locked, parsed.data.default_discount_class_id);
  if (lockErr) return { ok: false, error: lockErr };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('customer_sources').insert({
    code: parsed.data.code,
    name: parsed.data.name,
    default_billing_to_id: parsed.data.default_billing_to_id || null,
    default_discount_class_id: parsed.data.default_discount_class_id || null,
    discount_locked: parsed.data.discount_locked ?? false,
    phone_required: parsed.data.phone_required ?? true,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/customer-sources');
  return { ok: true };
}

export async function updateCustomerSource(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const lockErr = await variableLockError(d.discount_locked, d.default_discount_class_id);
  if (lockErr) return { ok: false, error: lockErr };
  const patch: SourceUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.default_billing_to_id !== undefined)
    patch.default_billing_to_id = d.default_billing_to_id || null;
  if (d.default_discount_class_id !== undefined)
    patch.default_discount_class_id = d.default_discount_class_id || null;
  if (d.discount_locked !== undefined) patch.discount_locked = d.discount_locked;
  if (d.phone_required !== undefined) patch.phone_required = d.phone_required;
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('customer_sources').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/customer-sources');
  return { ok: true };
}

export async function setCustomerSourceActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('customer_sources').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/customer-sources');
  return { ok: true };
}
