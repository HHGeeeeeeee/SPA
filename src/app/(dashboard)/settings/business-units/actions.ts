'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';

const schema = z.object({
  code: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'Code must be lowercase letters, digits, _ or -'),
  name: z.string().min(1).max(80),
});

const updateSchema = schema.partial({ code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createBusinessUnit(input: unknown): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const supabase = await createAuditedClient();
  const { error } = await supabase.from('business_units').insert({
    code: parsed.data.code,
    name: parsed.data.name,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/branches');
  return { ok: true };
}

export async function updateBusinessUnit(input: unknown): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const patch: { name?: string } = {};
  if (parsed.data.name) patch.name = parsed.data.name;

  const supabase = await createAuditedClient();
  const { error } = await supabase.from('business_units').update(patch).eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/branches');
  return { ok: true };
}

export async function setBusinessUnitActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('business_units').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/branches');
  return { ok: true };
}
