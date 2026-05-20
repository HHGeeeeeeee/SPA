'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';

const schema = z.object({
  branch_id: z.string().uuid(),
  source_id: z.string().uuid().optional().nullable(),
  billing_to_id: z.string().uuid().optional().nullable(),
  order_type: z.enum(['walk_in', 'reservation', 'package_use', 'stored_value', 'external']).default('walk_in'),
  service_date: z.string().min(1),
  note: z.string().max(500).optional().nullable(),
});

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function nextOrderNo(branchCode: string, serviceDate: string): Promise<string> {
  const supabase = createServiceClient();
  const ymd = serviceDate.replace(/-/g, '');
  const prefix = `SO-${branchCode}-${ymd}-`;
  const { data } = await supabase
    .from('orders')
    .select('order_no')
    .like('order_no', `${prefix}%`)
    .order('order_no', { ascending: false })
    .limit(1);
  const last = data?.[0]?.order_no;
  const lastSeq = last ? Number(last.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(3, '0')}`;
}

export async function createDraftOrder(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const supabase = createServiceClient();

  const { data: branch, error: be } = await supabase
    .from('branches')
    .select('code')
    .eq('id', d.branch_id)
    .single();
  if (be || !branch) return { ok: false, error: 'Branch not found' };

  const order_no = await nextOrderNo(branch.code, d.service_date);

  const { data, error } = await supabase
    .from('orders')
    .insert({
      order_no,
      branch_id: d.branch_id,
      source_id: d.source_id || null,
      billing_to_id: d.billing_to_id || null,
      order_type: d.order_type,
      service_date: d.service_date,
      note: d.note || null,
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed' };

  revalidatePath('/sales-orders');
  return { ok: true, data: { id: data.id } };
}

export async function voidOrder(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('orders').update({ status: 'void' }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/sales-orders');
  return { ok: true };
}
