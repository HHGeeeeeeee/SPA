'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireManager } from '@/lib/auth';

type PolicyUpdate = Database['public']['Tables']['commission_policies']['Update'];

const bandSchema = z.object({
  min_minutes: z.number().int().positive().nullable(),
  up_to_minutes: z.number().int().positive().nullable(),
  commission_rate: z.number().min(0).max(1),
});
const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  warmup_enabled: z.boolean(),
  warmup_occurrence: z.coerce.number().int().min(1).max(20),
  bands: z.array(bandSchema),
});
const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

// Replace a policy's duration bands, ordered by ceiling (NULL open-end last).
async function syncBands(policyId: string, bands: { min_minutes: number | null; up_to_minutes: number | null; commission_rate: number }[]) {
  const supabase = await createAuditedClient();
  await supabase.from('commission_policy_bands').delete().eq('policy_id', policyId);
  if (bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => {
    if (a.up_to_minutes == null) return 1;
    if (b.up_to_minutes == null) return -1;
    return a.up_to_minutes - b.up_to_minutes;
  });
  const { error } = await supabase.from('commission_policy_bands').insert(
    sorted.map((b, i) => ({ policy_id: policyId, min_minutes: b.min_minutes, up_to_minutes: b.up_to_minutes, commission_rate: b.commission_rate, sort_order: i })),
  );
  return error;
}

export async function createCommissionPolicy(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const supabase = await createAuditedClient();
  const { data, error } = await supabase
    .from('commission_policies')
    .insert({ code: d.code, name: d.name, warmup_enabled: d.warmup_enabled, warmup_occurrence: d.warmup_occurrence, active: true })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: `Code "${d.code}" already exists` };
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }
  const bandErr = await syncBands(data.id, d.warmup_enabled ? d.bands : []);
  if (bandErr) return { ok: false, error: bandErr.message };
  revalidatePath('/settings/commission-policies');
  return { ok: true };
}

export async function updateCommissionPolicy(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: PolicyUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.warmup_enabled !== undefined) patch.warmup_enabled = d.warmup_enabled;
  if (d.warmup_occurrence !== undefined) patch.warmup_occurrence = d.warmup_occurrence;
  const supabase = await createAuditedClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('commission_policies').update(patch).eq('id', d.id);
    if (error) return { ok: false, error: error.message };
  }
  if (d.bands) {
    const bandErr = await syncBands(d.id, d.warmup_enabled ? d.bands : []);
    if (bandErr) return { ok: false, error: bandErr.message };
  }
  revalidatePath('/settings/commission-policies');
  return { ok: true };
}

export async function setCommissionPolicyActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('commission_policies').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/commission-policies');
  return { ok: true };
}
