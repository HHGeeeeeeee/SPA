'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type CategoryUpdate = Database['public']['Tables']['service_categories']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  business_unit: z.string().min(1).max(20).default('spa'),
  commission_applicable: z.boolean().default(true),
  tip_applicable: z.boolean().default(true),
  revenue_account: z.string().max(20).optional().nullable(),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createServiceCategory(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_categories').insert({
    ...parsed.data,
    revenue_account: parsed.data.revenue_account || null,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/service-categories');
  return { ok: true };
}

export async function updateServiceCategory(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: CategoryUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.business_unit !== undefined) patch.business_unit = d.business_unit;
  if (d.commission_applicable !== undefined) patch.commission_applicable = d.commission_applicable;
  if (d.tip_applicable !== undefined) patch.tip_applicable = d.tip_applicable;
  if (d.revenue_account !== undefined) patch.revenue_account = d.revenue_account || null;
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_categories').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-categories');
  return { ok: true };
}

export async function setServiceCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_categories').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-categories');
  return { ok: true };
}
