'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type ServiceItemUpdate = Database['public']['Tables']['service_items']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  service_category_id: z.string().uuid(),
  duration_minutes: z.coerce.number().int().min(1).max(600),
  prep_before_minutes: z.coerce.number().int().min(0).max(120).default(0),
  cleanup_after_minutes: z.coerce.number().int().min(0).max(120).default(0),
  required_resource_type: z.string().max(40).optional().nullable(),
  pricing_model: z.enum(['per_session', 'membership_unlimited', 'membership_quota', 'subscription']).default('per_session'),
  commission_applicable: z.boolean().default(true),
  tip_applicable: z.boolean().default(true),
  business_unit: z.string().max(20).default('spa'),
});

const updateSchema = schema.partial().extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createServiceItem(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_items').insert({
    ...parsed.data,
    required_resource_type: parsed.data.required_resource_type || null,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/service-items');
  return { ok: true };
}

export async function updateServiceItem(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: ServiceItemUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.service_category_id !== undefined) patch.service_category_id = d.service_category_id;
  if (d.duration_minutes !== undefined) patch.duration_minutes = d.duration_minutes;
  if (d.prep_before_minutes !== undefined) patch.prep_before_minutes = d.prep_before_minutes;
  if (d.cleanup_after_minutes !== undefined) patch.cleanup_after_minutes = d.cleanup_after_minutes;
  if (d.required_resource_type !== undefined) patch.required_resource_type = d.required_resource_type || null;
  if (d.pricing_model !== undefined) patch.pricing_model = d.pricing_model;
  if (d.commission_applicable !== undefined) patch.commission_applicable = d.commission_applicable;
  if (d.tip_applicable !== undefined) patch.tip_applicable = d.tip_applicable;
  if (d.business_unit !== undefined) patch.business_unit = d.business_unit;
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_items').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-items');
  return { ok: true };
}

export async function setServiceItemActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_items').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-items');
  return { ok: true };
}
