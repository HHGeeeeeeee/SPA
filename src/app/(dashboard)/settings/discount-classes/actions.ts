'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { requireManager } from '@/lib/auth';

const schema = z
  .object({
    code: z.string().min(1).max(20),
    description: z.string().min(1).max(120),
    discount_percent: z.coerce.number().min(0).max(100).default(0),
    discount_amount_cents: z.coerce.number().int().min(0).default(0),
    requires_approval: z.boolean().default(false),
    force_apply: z.boolean().default(false),
  })
  .refine(
    (d) => d.discount_percent > 0 || d.discount_amount_cents > 0 || d.code === 'DIS-00' || d.code === 'DIS-99',
    { message: 'Either percent or amount must be > 0 (except DIS-00 / DIS-99)' },
  );

const updateSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1).max(120).optional(),
  discount_percent: z.coerce.number().min(0).max(100).optional(),
  discount_amount_cents: z.coerce.number().int().min(0).optional(),
  requires_approval: z.boolean().optional(),
  force_apply: z.boolean().optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createDiscountClass(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const supabase = await createAuditedClient();
  const { error } = await supabase.from('discount_classes').insert({ ...parsed.data, active: true });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/discount-classes');
  return { ok: true };
}

export async function updateDiscountClass(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { id, ...patch } = parsed.data;
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('discount_classes').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/discount-classes');
  return { ok: true };
}

export async function setDiscountClassActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('discount_classes').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/discount-classes');
  return { ok: true };
}
