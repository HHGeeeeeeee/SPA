'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type SettingUpdate = Database['public']['Tables']['settings']['Update'];

const schema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, digits, underscores. Must start with letter.'),
  value: z.string().min(1).max(500),
  value_type: z.enum(['string', 'integer', 'decimal', 'boolean']),
  description: z.string().max(500).optional().nullable(),
  scope: z.enum(['global', 'branch']).default('global'),
  branch_id: z.string().uuid().optional().nullable(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  value: z.string().min(1).max(500),
  description: z.string().max(500).optional().nullable(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function validateValueForType(value: string, type: 'string' | 'integer' | 'decimal' | 'boolean'): string | null {
  if (type === 'integer' && !/^-?\d+$/.test(value)) return 'Must be a whole number';
  if (type === 'decimal' && !/^-?\d+(\.\d+)?$/.test(value)) return 'Must be a number';
  if (type === 'boolean' && !['true', 'false'].includes(value)) return 'Must be true or false';
  return null;
}

export async function createSetting(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const typeErr = validateValueForType(d.value, d.value_type);
  if (typeErr) return { ok: false, error: typeErr };

  const supabase = createServiceClient();
  const { error } = await supabase.from('settings').insert({
    key: d.key,
    value: d.value,
    value_type: d.value_type,
    description: d.description || null,
    scope: d.scope,
    branch_id: d.scope === 'branch' ? d.branch_id || null : null,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Setting "${d.key}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/system');
  return { ok: true };
}

export async function updateSetting(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  // Load existing to check type
  const supabase = createServiceClient();
  const { data: existing, error: e1 } = await supabase
    .from('settings')
    .select('value_type')
    .eq('id', parsed.data.id)
    .single();
  if (e1) return { ok: false, error: e1.message };
  const typeErr = validateValueForType(parsed.data.value, existing.value_type as 'string' | 'integer' | 'decimal' | 'boolean');
  if (typeErr) return { ok: false, error: typeErr };

  const patch: SettingUpdate = { value: parsed.data.value };
  if (parsed.data.description !== undefined) patch.description = parsed.data.description || null;
  const { error } = await supabase.from('settings').update(patch).eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/system');
  return { ok: true };
}

export async function deleteSetting(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('settings').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/system');
  return { ok: true };
}
