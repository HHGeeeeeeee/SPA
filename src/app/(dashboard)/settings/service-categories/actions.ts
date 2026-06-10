'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireAdminOrAccountant } from '@/lib/auth';

type CategoryUpdate = Database['public']['Tables']['service_categories']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  business_unit_ids: z.array(z.string().uuid()).min(1, 'Pick at least one business unit'),
  commission_applicable: z.boolean().default(true),
  tip_applicable: z.boolean().default(true),
  revenue_account: z.string().max(20).optional().nullable(),
  // Revenue transaction code bound to this category — its code rides every
  // revenue folio line a service in this category posts (e.g. on Start).
  revenue_transaction_code_id: z.string().uuid().optional().nullable(),
  required_resource_types: z.array(z.string().max(40)).default([]),
});

const updateSchema = schema.partial({ code: true }).extend({ id: z.string().uuid() });

export type ActionResult = { ok: true } | { ok: false; error: string };

async function syncJunction(categoryId: string, businessUnitIds: string[]) {
  const supabase = await createAuditedClient();
  const del = await supabase
    .from('service_category_business_units')
    .delete()
    .eq('service_category_id', categoryId);
  if (del.error) return del.error;
  if (businessUnitIds.length === 0) return null;
  const ins = await supabase.from('service_category_business_units').insert(
    businessUnitIds.map((business_unit_id) => ({
      service_category_id: categoryId,
      business_unit_id,
    })),
  );
  return ins.error;
}

export async function createServiceCategory(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = await createAuditedClient();
  const { data, error } = await supabase
    .from('service_categories')
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      commission_applicable: parsed.data.commission_applicable,
      tip_applicable: parsed.data.tip_applicable,
      revenue_account: parsed.data.revenue_account || null,
      revenue_transaction_code_id: parsed.data.revenue_transaction_code_id || null,
      required_resource_types: parsed.data.required_resource_types,
      // Keep the legacy single column in sync (= first picked) so existing
      // reservation/calendar capacity readers keep working until they migrate.
      required_resource_type: parsed.data.required_resource_types[0] ?? null,
      active: true,
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }

  const linkErr = await syncJunction(data.id, parsed.data.business_unit_ids);
  if (linkErr) return { ok: false, error: linkErr.message };

  revalidatePath('/settings/service-categories');
  return { ok: true };
}

export async function updateServiceCategory(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: CategoryUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.commission_applicable !== undefined) patch.commission_applicable = d.commission_applicable;
  if (d.tip_applicable !== undefined) patch.tip_applicable = d.tip_applicable;
  if (d.revenue_account !== undefined) patch.revenue_account = d.revenue_account || null;
  if (d.revenue_transaction_code_id !== undefined) patch.revenue_transaction_code_id = d.revenue_transaction_code_id || null;
  if (d.required_resource_types !== undefined) {
    patch.required_resource_types = d.required_resource_types;
    // Keep the legacy single column in sync (= first picked).
    patch.required_resource_type = d.required_resource_types[0] ?? null;
  }
  const supabase = await createAuditedClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('service_categories').update(patch).eq('id', d.id);
    if (error) return { ok: false, error: error.message };
  }

  if (d.business_unit_ids) {
    const linkErr = await syncJunction(d.id, d.business_unit_ids);
    if (linkErr) return { ok: false, error: linkErr.message };
  }

  revalidatePath('/settings/service-categories');
  return { ok: true };
}

export async function setServiceCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireAdminOrAccountant();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('service_categories').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-categories');
  return { ok: true };
}
