'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { requireManager } from '@/lib/auth';

const schema = z.object({
  class_code: z.string().min(1).max(10),
  name: z.string().min(1).max(60),
  // Accept percent input as 0-100, persist as 0-1 numeric
  rate_percent: z.coerce.number().min(0).max(100),
});

const updateSchema = schema.partial({ class_code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createCommissionClass(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const supabase = await createAuditedClient();
  const { error } = await supabase.from('commission_classes').insert({
    class_code: parsed.data.class_code,
    name: parsed.data.name,
    commission_rate: parsed.data.rate_percent / 100,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.class_code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/commission-policies');
  return { ok: true };
}

export async function updateCommissionClass(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const patch: { name?: string; commission_rate?: number } = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.rate_percent !== undefined) patch.commission_rate = parsed.data.rate_percent / 100;

  const supabase = await createAuditedClient();
  const { error } = await supabase.from('commission_classes').update(patch).eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/commission-policies');
  return { ok: true };
}

export async function setCommissionClassActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('commission_classes').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/commission-policies');
  return { ok: true };
}
