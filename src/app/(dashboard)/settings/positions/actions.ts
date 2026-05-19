'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

const schema = z.object({
  code: z.string().min(1).max(40).regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, _ or -'),
  name: z.string().min(1).max(80),
  business_unit_ids: z.array(z.string().uuid()).min(1, 'Pick at least one business unit'),
});

const updateSchema = schema.partial({ code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

async function syncJunction(positionId: string, businessUnitIds: string[]) {
  const supabase = createServiceClient();
  // wipe + reinsert is simpler than diffing
  const del = await supabase
    .from('position_business_units')
    .delete()
    .eq('position_id', positionId);
  if (del.error) return del.error;
  if (businessUnitIds.length === 0) return null;
  const ins = await supabase.from('position_business_units').insert(
    businessUnitIds.map((business_unit_id) => ({
      position_id: positionId,
      business_unit_id,
    })),
  );
  return ins.error;
}

export async function createPosition(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('positions')
    .insert({ code: parsed.data.code, name: parsed.data.name, active: true })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }

  const linkErr = await syncJunction(data.id, parsed.data.business_unit_ids);
  if (linkErr) return { ok: false, error: linkErr.message };

  revalidatePath('/settings/positions');
  return { ok: true };
}

export async function updatePosition(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const patch: { name?: string } = {};
  if (parsed.data.name) patch.name = parsed.data.name;

  const supabase = createServiceClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('positions').update(patch).eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
  }

  if (parsed.data.business_unit_ids) {
    const linkErr = await syncJunction(parsed.data.id, parsed.data.business_unit_ids);
    if (linkErr) return { ok: false, error: linkErr.message };
  }

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
