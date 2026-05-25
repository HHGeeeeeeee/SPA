import 'server-only';
import bcrypt from 'bcryptjs';

import { createServiceClient } from '@/lib/supabase/server';
import { acumaticaLogin, acumaticaLogout } from '@/lib/acumatica';
import { readSession, type SessionPayload } from '@/lib/session';

export type Role = SessionPayload['role'];

const acumaticaConfigured = (): boolean => !!process.env.ACUMATICA_BASE_URL;

export type LoginResult =
  | { ok: true; session: SessionPayload; acuCookie: string | null }
  | { ok: false; error: string };

/**
 * Primary login. When Acumatica is configured it is the source of truth:
 * credentials are validated against the ERP and bridged to a local staff_users
 * row (the returned acuCookie is stored so later GL posts run as this user).
 * Until Acumatica is configured, falls back to the local bcrypt password so the
 * system stays usable.
 */
export async function authenticate(username: string, password: string): Promise<LoginResult> {
  const id = username.trim();
  if (!id || !password) return { ok: false, error: 'Enter your username and password' };

  if (acumaticaConfigured()) return authenticateViaAcumatica(id, password);

  // Fallback: local bcrypt (Acumatica not configured yet). verifyCredentials
  // looks up by email, which doubles as the local username here.
  const session = await verifyCredentials(id, password);
  if (!session) return { ok: false, error: 'Invalid username or password' };
  return { ok: true, session, acuCookie: null };
}

async function authenticateViaAcumatica(username: string, password: string): Promise<LoginResult> {
  const res = await acumaticaLogin(username, password);
  if (!res.ok) return { ok: false, error: res.error };

  const supabase = createServiceClient();
  const { data: u } = await supabase
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active')
    .eq('acumatica_user_id', username)
    .maybeSingle();

  // Authenticated against the ERP but unknown locally → provision an inactive
  // record and have an admin activate it. Close the ERP session we just opened.
  if (!u) {
    const email = username.includes('@') ? username.toLowerCase() : `${username}@acumatica.local`;
    await supabase.from('staff_users').insert({
      acumatica_user_id: username, email, display_name: username, role: 'staff', active: false,
    });
    await acumaticaLogout(res.cookie);
    return { ok: false, error: 'Account created and is pending administrator approval.' };
  }
  if (!u.active) {
    await acumaticaLogout(res.cookie);
    return { ok: false, error: 'Your account is not active yet — ask an administrator to activate it.' };
  }

  await supabase.from('staff_users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id);
  return {
    ok: true,
    session: {
      staffUserId: u.id,
      email: u.email,
      acumaticaUserId: u.acumatica_user_id,
      displayName: u.display_name,
      role: u.role as Role,
      homeBranchId: u.home_branch_id,
    },
    acuCookie: res.cookie || null,
  };
}

/** Verify email + password against staff_users (local bcrypt). */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionPayload | null> {
  const supabase = createServiceClient();
  const { data: u } = await supabase
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active, password_hash')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  if (!u || !u.active || !u.password_hash) return null;
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return null;
  await supabase.from('staff_users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id);
  return {
    staffUserId: u.id,
    email: u.email,
    acumaticaUserId: u.acumatica_user_id,
    displayName: u.display_name,
    role: u.role as Role,
    homeBranchId: u.home_branch_id,
  };
}

// Dev-only login bypass: when AUTH_BYPASS=true and there is no real session,
// act as the seeded admin. Controlled by env (default off) so it never ships on.
async function bypassAdminSession(): Promise<SessionPayload | null> {
  if (process.env.AUTH_BYPASS !== 'true') return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id')
    .eq('email', 'admin@acumatica.local')
    .maybeSingle();
  if (data) {
    return {
      staffUserId: data.id,
      email: data.email,
      acumaticaUserId: data.acumatica_user_id,
      displayName: data.display_name,
      role: data.role as Role,
      homeBranchId: data.home_branch_id,
    };
  }
  return {
    staffUserId: '00000000-0000-0000-0000-000000000000',
    email: 'admin@acumatica.local',
    acumaticaUserId: 'admin',
    displayName: 'System Admin (bypass)',
    role: 'admin',
    homeBranchId: null,
  };
}

export async function currentSession(): Promise<SessionPayload | null> {
  return (await readSession()) ?? (await bypassAdminSession());
}

export function isManager(s: SessionPayload | null): boolean {
  return !!s && (s.role === 'manager' || s.role === 'admin');
}

export function isAdmin(s: SessionPayload | null): boolean {
  return !!s && s.role === 'admin';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
