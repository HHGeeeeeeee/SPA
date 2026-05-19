'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type SourceUpdate = Database['public']['Tables']['customer_sources']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  default_billing_to_id: z.string().uuid().optional().nullable(),
  default_discount_class_id: z.string().uuid().optional().nullable(),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createCustomerSource(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('customer_sources').insert({
    code: parsed.data.code,
    name: parsed.data.name,
    default_billing_to_id: parsed.data.default_billing_to_id || null,
    default_discount_class_id: parsed.data.default_discount_class_id || null,
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
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: SourceUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.default_billing_to_id !== undefined)
    patch.default_billing_to_id = d.default_billing_to_id || null;
  if (d.default_discount_class_id !== undefined)
    patch.default_discount_class_id = d.default_discount_class_id || null;
  const supabase = createServiceClient();
  const { error } = await supabase.from('customer_sources').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/customer-sources');
  return { ok: true };
}

export async function setCustomerSourceActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('customer_sources').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/customer-sources');
  return { ok: true };
}
