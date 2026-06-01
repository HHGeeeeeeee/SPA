'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { createAuditedClient, createServiceClient } from '@/lib/supabase/server';
import { currentSession, requireManager, isAdmin } from '@/lib/auth';
import type { Database } from '@/types/database';

/**
 * Scope guard for the User management actions.
 *
 * Two-tier policy:
 *   - Admin     → can manage anyone
 *   - Manager   → can manage role='staff' only (NOT other managers,
 *                 NOT external_booker, NOT admin)
 *
 * Why so narrow on the manager side: every direction other than staff is
 * an escalation path or peer-tampering surface.
 *   - manager → admin   = self-promote by minting a fresh admin
 *   - manager → manager = take over a peer's account (reset password / PIN
 *                          → log in as them and bypass own action limits)
 *   - manager → booker  = no operational reason; bookers self-serve
 *
 * Pass `targetUserId` when modifying an existing row (we look up the row's
 * current role). Pass `payloadRole` when the action is creating or
 * assigning a role (we refuse anything other than 'staff' from a manager).
 *
 * Manager's own row: blocked too — self-edit lives on /account, not here.
 */
async function guardUserMgmt(args: {
  targetUserId?: string;
  payloadRole?: string;
}): Promise<string | null> {
  const session = await currentSession();
  if (isAdmin(session)) return null; // admin can do everything

  // Manager beyond this point.
  if (args.payloadRole && args.payloadRole !== 'staff') {
    return 'Manager can only create or assign the staff role';
  }
  if (args.targetUserId) {
    const sb = createServiceClient();
    const { data } = await sb.from('staff_users').select('role').eq('id', args.targetUserId).maybeSingle();
    if (data && data.role !== 'staff') {
      return 'Manager can only edit staff users';
    }
  }
  return null;
}

type StaffUserUpdate = Database['public']['Tables']['staff_users']['Update'];

const passwordSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

const schema = z.object({
  acumatica_user_id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot/dash/underscore only'),
  display_name: z.string().max(80).optional().nullable(),
  role: z.enum(['admin', 'manager', 'staff', 'external_booker']),
  home_branch_id: z.string().uuid().optional().nullable(),
  branch_ids: z.array(z.string().uuid()).optional(),
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

async function syncBranches(staffUserId: string, branchIds: string[]) {
  const supabase = await createAuditedClient();
  const del = await supabase
    .from('staff_user_branches')
    .delete()
    .eq('staff_user_id', staffUserId);
  if (del.error) return del.error;
  if (branchIds.length === 0) return null;
  const ins = await supabase.from('staff_user_branches').insert(
    branchIds.map((branch_id) => ({ staff_user_id: staffUserId, branch_id })),
  );
  return ins.error;
}

export async function createStaffUser(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const guard = await guardUserMgmt({ payloadRole: d.role });
  if (guard) return { ok: false, error: guard };
  const email = `${d.acumatica_user_id.toLowerCase()}@acumatica.local`;
  const supabase = await createAuditedClient();
  const { data, error } = await supabase
    .from('staff_users')
    .insert({
      email,
      acumatica_user_id: d.acumatica_user_id,
      display_name: d.display_name || null,
      role: d.role,
      home_branch_id: d.home_branch_id || null,
      active: d.active,
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: 'User with that Acumatica ID or email already exists' };
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }

  const linkErr = await syncBranches(data.id, d.branch_ids ?? []);
  if (linkErr) return { ok: false, error: linkErr.message };

  revalidatePath('/settings/users');
  return { ok: true };
}

export async function updateStaffUser(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  // Block both directions: (a) editing an existing admin's row, (b) promoting
  // anyone else TO admin. Either lets a manager self-elevate.
  const guard = await guardUserMgmt({ targetUserId: d.id, payloadRole: d.role });
  if (guard) return { ok: false, error: guard };
  const patch: StaffUserUpdate = {};
  if (d.display_name !== undefined) patch.display_name = d.display_name || null;
  if (d.role !== undefined) patch.role = d.role;
  if (d.home_branch_id !== undefined) patch.home_branch_id = d.home_branch_id || null;
  if (d.active !== undefined) patch.active = d.active;
  const supabase = await createAuditedClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('staff_users').update(patch).eq('id', d.id);
    if (error) return { ok: false, error: error.message };
  }

  if (d.branch_ids) {
    const linkErr = await syncBranches(d.id, d.branch_ids);
    if (linkErr) return { ok: false, error: linkErr.message };
  }

  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setStaffUserActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  // Don't let a manager deactivate (or reactivate) an admin — same
  // escalation surface: deactivate the last admin to lock out the company.
  const guard = await guardUserMgmt({ targetUserId: id });
  if (guard) return { ok: false, error: guard };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('staff_users').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setStaffUserPassword(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid password' };
  // A manager resetting an admin's password = takes over the admin account.
  const guard = await guardUserMgmt({ targetUserId: parsed.data.id });
  if (guard) return { ok: false, error: guard };
  const hash = await bcrypt.hash(parsed.data.password, 10);
  const supabase = await createAuditedClient();
  const { error } = await supabase
    .from('staff_users')
    .update({ password_hash: hash })
    .eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function setManagerPin(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid PIN' };
  // Setting an admin's PIN = same attack surface as resetting their password.
  const guard = await guardUserMgmt({ targetUserId: parsed.data.id });
  if (guard) return { ok: false, error: guard };
  const hash = await bcrypt.hash(parsed.data.pin, 10);
  const supabase = await createAuditedClient();
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
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const guard = await guardUserMgmt({ targetUserId: id });
  if (guard) return { ok: false, error: guard };
  const supabase = await createAuditedClient();
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
