'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type ResourceUpdate = Database['public']['Tables']['resources']['Update'];

const schema = z.object({
  branch_id: z.string().uuid(),
  resource_type: z.enum(['massage_bed', 'rest_room', 'hair_chair', 'nail_table', 'steam_room']),
  resource_name: z.string().min(1).max(80),
  location_zone: z.string().max(40).optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(20).default(1),
  business_unit_id: z.string().uuid().optional().nullable(),
});

const updateSchema = schema.partial().extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createResource(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('resources').insert({
    ...parsed.data,
    location_zone: parsed.data.location_zone || null,
    status: 'active',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/resources');
  return { ok: true };
}

export async function updateResource(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: ResourceUpdate = {};
  if (d.branch_id !== undefined) patch.branch_id = d.branch_id;
  if (d.resource_type !== undefined) patch.resource_type = d.resource_type;
  if (d.resource_name !== undefined) patch.resource_name = d.resource_name;
  if (d.location_zone !== undefined) patch.location_zone = d.location_zone || null;
  if (d.capacity !== undefined) patch.capacity = d.capacity;
  if (d.business_unit_id !== undefined) patch.business_unit_id = d.business_unit_id ?? null;
  const supabase = createServiceClient();
  const { error } = await supabase.from('resources').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/resources');
  return { ok: true };
}

export async function setResourceStatus(
  id: string,
  status: 'active' | 'cleaning' | 'maintenance' | 'closed',
  reason?: string,
): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('resources')
    .update({
      status,
      status_changed_at: new Date().toISOString(),
      status_reason: reason ?? null,
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/resources');
  return { ok: true };
}
