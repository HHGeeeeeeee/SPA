'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type EmployeeUpdate = Database['public']['Tables']['employees']['Update'];

const baseSchema = z.object({
  employee_code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(120).optional().nullable().or(z.literal('')),
  gender: z.enum(['M', 'F', 'Other']).optional().nullable(),
  home_branch_id: z.string().uuid().optional().nullable(),
  commission_class_id: z.string().uuid().optional().nullable(),
  position_id: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'inactive', 'on_leave']).default('active'),
});

const updateSchema = baseSchema.partial({ employee_code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

function normalize(input: z.infer<typeof baseSchema>) {
  return {
    employee_code: input.employee_code,
    name: input.name,
    phone: input.phone || null,
    email: input.email || null,
    gender: input.gender || null,
    home_branch_id: input.home_branch_id || null,
    commission_class_id: input.commission_class_id || null,
    position_id: input.position_id || null,
    status: input.status,
  };
}

export async function createEmployee(input: unknown): Promise<ActionResult> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const { error } = await supabase.from('employees').insert(normalize(parsed.data));
  if (error) {
    if (error.code === '23505') {
      const conflict = /employees_phone_key/.test(error.message) ? 'phone' : 'employee_code';
      return { ok: false, error: `${conflict} already exists` };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/employees');
  return { ok: true };
}

export async function updateEmployee(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: EmployeeUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.phone !== undefined) patch.phone = d.phone || null;
  if (d.email !== undefined) patch.email = d.email || null;
  if (d.gender !== undefined) patch.gender = d.gender || null;
  if (d.home_branch_id !== undefined) patch.home_branch_id = d.home_branch_id || null;
  if (d.commission_class_id !== undefined) patch.commission_class_id = d.commission_class_id || null;
  if (d.position_id !== undefined) patch.position_id = d.position_id || null;
  if (d.status !== undefined) patch.status = d.status;
  const supabase = createServiceClient();
  const { error } = await supabase.from('employees').update(patch).eq('id', d.id);
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'phone already exists' };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/employees');
  return { ok: true };
}

export async function setEmployeeStatus(
  id: string,
  status: 'active' | 'inactive' | 'on_leave',
): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('employees').update({ status }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/employees');
  return { ok: true };
}
