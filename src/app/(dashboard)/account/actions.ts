'use server';

import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { currentSession } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

type ActionResult = { ok: true } | { ok: false; error: string };

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(72),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'New passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * Self-service password change for the signed-in user. Verifies the current
 * password against the local bcrypt hash, then updates both staff_users
 * (the local credential) and the bridged Supabase Auth user so the next login
 * — which signs in against Supabase Auth — uses the new password immediately.
 *
 * Note: when Acumatica is configured, login is ERP-backed and the password
 * lives in Acumatica, not here — change it there instead.
 */
export async function changeOwnPassword(input: unknown): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'You are not signed in' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const svc = createServiceClient();
  const { data: u, error: readErr } = await svc
    .from('staff_users')
    .select('id, password_hash, auth_user_id')
    .eq('id', session.staffUserId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!u || !u.password_hash) {
    return { ok: false, error: 'This account has no local password to change' };
  }

  const matches = await bcrypt.compare(parsed.data.currentPassword, u.password_hash);
  if (!matches) return { ok: false, error: 'Current password is incorrect' };

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  const { error: updErr } = await svc
    .from('staff_users')
    .update({ password_hash: hash })
    .eq('id', u.id);
  if (updErr) return { ok: false, error: updErr.message };

  // Keep the bridged Supabase Auth user in sync so the change takes effect on
  // the very next login (otherwise the auth bridge only self-heals lazily).
  if (u.auth_user_id) {
    const { error: authErr } = await svc.auth.admin.updateUserById(u.auth_user_id, {
      password: parsed.data.newPassword,
    });
    if (authErr) return { ok: false, error: `Saved locally but auth sync failed: ${authErr.message}` };
  }

  return { ok: true };
}
