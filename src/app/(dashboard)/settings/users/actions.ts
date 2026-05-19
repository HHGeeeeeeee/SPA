'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type StaffUserUpdate = Database['public']['Tables']['staff_users']['Update'];

const schema = z.object({
  acumatica_user_id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot/dash/underscore only'),
  display_name: z.string().max(80).optional().nullable(),
  role: z.enum(['admin', 'manager', 'staff', 'external_booker']),
  home_branch_id: z.string().uuid().optional().nullable(),
  active: z.boolean().default(false),
});

const updateSchema = schema.partial({ acumatica_user_id: true }).extend({
  id: z.string().uuid(),
});

const pinSchema = z.object({
  id: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits'),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createStaffUser(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const email = `${d.acumatica_user_id.toLowerCase()}@acumatica.local`;
  const supabase = createServiceClient();
  const { error } = await supabase.from('staff_users').insert({
    email,
    acumatica_user_id: d.acumatica_user_id,
    display_name: d.display_name || null,
    role: d.role,
    home_branch_id: d.home_branch_id || null,
    active: d.active,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'User with that Acumatica ID or email already exists' };
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function updateStaffUser(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: StaffUserUpdate = {};
  if (d.display_name !== undefined) patch.display_name = d.display_name || null;
  if (d.role !== undefined) patch.role = d.role;
  if (d.home_branch_id !== undefined) patch.home_branch_id = d.home_branch_id || null;
  if (d.active !== undefined) patch.active = d.active;
  const supabase = createServiceClient();
  const { error } = await supabase.from('staff_users').update(patch).eq('id', d.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setStaffUserActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('staff_users').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setManagerPin(input: unknown): Promise<ActionResult> {
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid PIN' };
  const hash = await bcrypt.hash(parsed.data.pin, 10);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('staff_users')
    .update({
      manager_pin_hash: hash,
      manager_pin_set_at: new Date().toISOString(),
      manager_pin_failed_attempts: 0,
      manager_pin_locked_until: null,
    })
    .eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function clearManagerPin(id: string): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('staff_users')
    .update({
      manager_pin_hash: null,
      manager_pin_set_at: null,
      manager_pin_failed_attempts: 0,
      manager_pin_locked_until: null,
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/users');
  return { ok: true };
}
