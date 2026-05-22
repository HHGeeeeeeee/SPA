'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

const branchSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/, 'Uppercase letters, digits, - and _ only'),
  name: z.string().min(1).max(120),
  business_unit_ids: z.array(z.string().uuid()).min(1, 'Pick at least one business unit'),
  reservation_enabled: z.boolean().optional(),
});

const updateSchema = branchSchema.partial({ code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function syncJunction(branchId: string, businessUnitIds: string[]) {
  const supabase = createServiceClient();
  const del = await supabase
    .from('branch_business_units')
    .delete()
    .eq('branch_id', branchId);
  if (del.error) return del.error;
  if (businessUnitIds.length === 0) return null;
  const ins = await supabase.from('branch_business_units').insert(
    businessUnitIds.map((business_unit_id) => ({ branch_id: branchId, business_unit_id })),
  );
  return ins.error;
}

export async function createBranch(input: unknown): Promise<ActionResult> {
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('branches')
    .insert({ code: parsed.data.code, name: parsed.data.name, active: true, reservation_enabled: parsed.data.reservation_enabled ?? true })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, error: `Branch code "${parsed.data.code}" already exists` };
    }
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }

  const linkErr = await syncJunction(data.id, parsed.data.business_unit_ids);
  if (linkErr) return { ok: false, error: linkErr.message };

  revalidatePath('/settings/branches');
  return { ok: true };
}

export async function updateBranch(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const supabase = createServiceClient();
  const patch: { name?: string; reservation_enabled?: boolean } = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.reservation_enabled !== undefined) patch.reservation_enabled = parsed.data.reservation_enabled;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('branches').update(patch).eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
  }

  if (parsed.data.business_unit_ids) {
    const linkErr = await syncJunction(parsed.data.id, parsed.data.business_unit_ids);
    if (linkErr) return { ok: false, error: linkErr.message };
  }

  revalidatePath('/settings/branches');
  return { ok: true };
}

export async function setBranchActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('branches').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/branches');
  return { ok: true };
}
