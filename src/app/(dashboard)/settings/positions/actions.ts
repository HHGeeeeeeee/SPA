'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

const schema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, _ or -'),
  name: z.string().min(1).max(80),
  business_unit: z.string().min(1).max(40).default('spa'),
});

const updateSchema = schema.partial({ code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createPosition(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const supabase = createServiceClient();
  const { error } = await supabase.from('positions').insert({
    code: parsed.data.code,
    name: parsed.data.name,
    business_unit: parsed.data.business_unit,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/positions');
  return { ok: true };
}

export async function updatePosition(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const patch: { name?: string; business_unit?: string } = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.business_unit) patch.business_unit = parsed.data.business_unit;

  const supabase = createServiceClient();
  const { error } = await supabase.from('positions').update(patch).eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/positions');
  return { ok: true };
}

export async function setPositionActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('positions').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/positions');
  revalidatePath('/settings/employees');
  return { ok: true };
}
