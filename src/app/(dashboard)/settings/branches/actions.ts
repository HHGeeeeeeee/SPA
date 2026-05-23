'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

const branchSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/, 'Uppercase letters, digits, - and _ only'),
  name: z.string().min(1).max(120),
  business_unit_ids: z.array(z.string().uuid()).min(1, 'Pick at least one business unit'),
  reservation_enabled: z.boolean().optional(),
  // Branches sharing the same non-empty label pool their therapists (borrowing).
  therapist_share_group: z.string().max(60).optional().nullable(),
  commission_policy_id: z.string().uuid().optional().nullable(),
  // Per-branch class-rate overrides (this store's own % for a class). Branches
  // without an override use the global commission_classes rate.
  commission_rate_overrides: z.array(z.object({ commission_class_id: z.string().uuid(), rate: z.number().min(0).max(1) })).optional(),
});

const updateSchema = branchSchema.partial({ code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// Replace a branch's per-class rate overrides (delete then insert).
async function syncRateOverrides(branchId: string, overrides: { commission_class_id: string; rate: number }[] | undefined) {
  if (!overrides) return null;
  const supabase = createServiceClient();
  const del = await supabase.from('branch_commission_rates').delete().eq('branch_id', branchId);
  if (del.error) return del.error;
  if (overrides.length === 0) return null;
  const ins = await supabase.from('branch_commission_rates').insert(
    overrides.map((o) => ({ branch_id: branchId, commission_class_id: o.commission_class_id, commission_rate: o.rate })),
  );
  return ins.error;
}

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
    .insert({ code: parsed.data.code, name: parsed.data.name, active: true, reservation_enabled: parsed.data.reservation_enabled ?? true, therapist_share_group: parsed.data.therapist_share_group?.trim() || null, commission_policy_id: parsed.data.commission_policy_id ?? null })
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
  const rateErr = await syncRateOverrides(data.id, parsed.data.commission_rate_overrides);
  if (rateErr) return { ok: false, error: rateErr.message };

  revalidatePath('/settings/branches');
  return { ok: true };
}

export async function updateBranch(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const supabase = createServiceClient();
  const patch: { name?: string; reservation_enabled?: boolean; commission_policy_id?: string | null; therapist_share_group?: string | null } = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.reservation_enabled !== undefined) patch.reservation_enabled = parsed.data.reservation_enabled;
  if (parsed.data.therapist_share_group !== undefined) patch.therapist_share_group = parsed.data.therapist_share_group?.trim() || null;
  if (parsed.data.commission_policy_id !== undefined) patch.commission_policy_id = parsed.data.commission_policy_id || null;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('branches').update(patch).eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
  }

  if (parsed.data.business_unit_ids) {
    const linkErr = await syncJunction(parsed.data.id, parsed.data.business_unit_ids);
    if (linkErr) return { ok: false, error: linkErr.message };
  }
  const rateErr = await syncRateOverrides(parsed.data.id, parsed.data.commission_rate_overrides);
  if (rateErr) return { ok: false, error: rateErr.message };

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

// Set/clear a branch's therapist sharing group (lightweight — used by the
// Therapist Sharing management page). Branches sharing a non-empty label pool
// their therapists for cross-branch borrowing.
export async function setBranchShareGroup(id: string, group: string | null): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'Missing branch' };
  const value = (group ?? '').trim().slice(0, 60) || null;
  const supabase = createServiceClient();
  const { error } = await supabase.from('branches').update({ therapist_share_group: value }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/therapist-groups');
  revalidatePath('/settings/branches');
  revalidatePath('/shift-schedule');
  return { ok: true };
}
