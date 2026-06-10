import 'server-only';
import { cache } from 'react';
import bcrypt from 'bcryptjs';

import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { acumaticaLogin, acumaticaLogout } from '@/lib/acumatica';
import type { SessionPayload } from '@/lib/session';

export type Role = SessionPayload['role'];

const acumaticaConfigured = (): boolean => !!process.env.ACUMATICA_BASE_URL;

/**
 * Resolve the AUTH_BYPASS env into a target email, or null if bypass is off.
 * Treats the literal strings "false" / "0" / empty as "off" so that
 * `AUTH_BYPASS=false` (the common "explicit disable" form) really disables it.
 * `AUTH_BYPASS=true` resolves to the seeded admin. Anything else is treated as
 * an email to impersonate.
 */
export function bypassTargetEmail(): string | null {
  const v = (process.env.AUTH_BYPASS ?? '').trim().toLowerCase();
  if (!v || v === 'false' || v === '0') return null;
  if (v === 'true') return 'admin@acumatica.local';
  return v;
}

export type LoginResult =
  | { ok: true; acuCookie: string | null; email: string }
  | { ok: false; error: string };

/**
 * Primary login. When Acumatica is configured it's the source of truth:
 * credentials are validated against the ERP, then bridged to a Supabase Auth
 * session (so the auth.users row + the staff_users row are linked and every
 * downstream piece — middleware, server actions, audit log — can use the
 * same identity primitive).
 *
 * Until Acumatica is configured, falls back to the local bcrypt password on
 * staff_users + the same Supabase Auth bridge.
 *
 * The Supabase session cookies are written by `signInWithPassword` via the
 * SSR client's cookie shim; the caller (the login action) only needs to set
 * the Acumatica session cookie returned in `acuCookie`.
 */
export async function authenticate(username: string, password: string): Promise<LoginResult> {
  const id = username.trim();
  if (!id || !password) return { ok: false, error: 'Enter your username and password' };

  if (acumaticaConfigured()) return authenticateViaAcumatica(id, password);
  return authenticateLocally(id, password);
}

/**
 * ERP-backed login. After Acumatica accepts the credentials, the user is
 * looked up in staff_users (auto-provisioned inactive on first sight) and
 * bridged into Supabase Auth: the Auth user's password is kept in sync with
 * Acumatica so a password change on the ERP side just flows through here.
 */
async function authenticateViaAcumatica(username: string, password: string): Promise<LoginResult> {
  const res = await acumaticaLogin(username, password);
  if (!res.ok) return { ok: false, error: res.error };

  const svc = createServiceClient();
  const { data: u } = await svc
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active, auth_user_id')
    .eq('acumatica_user_id', username)
    .maybeSingle();

  // Authenticated against the ERP but unknown locally → provision an inactive
  // record and have an admin activate it. Close the ERP session we just opened.
  if (!u) {
    const email = username.includes('@') ? username.toLowerCase() : `${username}@acumatica.local`;
    await svc.from('staff_users').insert({
      acumatica_user_id: username, email, display_name: username, role: 'staff', active: false,
    });
    await acumaticaLogout(res.cookie);
    return { ok: false, error: 'Account created and is pending administrator approval.' };
  }
  if (!u.active) {
    await acumaticaLogout(res.cookie);
    return { ok: false, error: 'Your account is not active yet — ask an administrator to activate it.' };
  }

  const bridged = await bridgeSupabaseAuthSession(u, password);
  if (!bridged.ok) {
    await acumaticaLogout(res.cookie);
    return { ok: false, error: bridged.error };
  }

  await svc.from('staff_users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id);
  return { ok: true, acuCookie: res.cookie || null, email: u.email };
}

/**
 * Local-only login (dev / setup phase before Acumatica is configured). Same
 * Supabase Auth bridge as the ERP path so currentSession() can pretend they're
 * the same path downstream.
 */
async function authenticateLocally(emailOrUsername: string, password: string): Promise<LoginResult> {
  const svc = createServiceClient();
  const { data: u } = await svc
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active, password_hash, auth_user_id')
    .eq('email', emailOrUsername.trim().toLowerCase())
    .maybeSingle();
  if (!u || !u.active || !u.password_hash) return { ok: false, error: 'Invalid username or password' };
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return { ok: false, error: 'Invalid username or password' };

  const bridged = await bridgeSupabaseAuthSession(u, password);
  if (!bridged.ok) return { ok: false, error: bridged.error };

  await svc.from('staff_users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id);
  return { ok: true, acuCookie: null, email: u.email };
}

/**
 * Take a verified staff_users row + the cleartext password the user typed and
 * make sure a matching Supabase Auth session exists in the cookie jar. Three
 * cases:
 *
 *   1. Auth user exists + password matches  → signInWithPassword succeeds.
 *   2. Auth user exists + password mismatch (e.g. ERP password was rotated)
 *      → updateUserById to sync, then signInWithPassword.
 *   3. Auth user doesn't exist (e.g. first login after the Supabase Auth
 *      bridge was introduced) → admin.createUser, then signInWithPassword.
 *
 * The signIn writes the auth cookies through the SSR client's cookie shim.
 * The audit-trail link (staff_users.auth_user_id) is written on first sight.
 */
async function bridgeSupabaseAuthSession(
  u: {
    id: string;
    email: string;
    acumatica_user_id: string;
    display_name: string | null;
    role: string;
    auth_user_id: string | null;
  },
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ssr = await createServerClient();
  const svc = createServiceClient();
  const metadata = {
    staff_user_id: u.id,
    username: u.acumatica_user_id,
    display_name: u.display_name,
    role: u.role,
    source: 'acumatica',
  };

  // 1. Try the happy path first.
  let { data: signed, error: signInErr } = await ssr.auth.signInWithPassword({ email: u.email, password });

  if (signInErr) {
    // 2 & 3 — try to find the existing auth user (might exist but with a
    // stale password) and either resync or create from scratch.
    const { data: list } = await svc.auth.admin.listUsers();
    const existing = list?.users?.find((x) => x.email?.toLowerCase() === u.email.toLowerCase());

    if (existing) {
      // Password drift — sync to the value the user just authenticated with.
      const upd = await svc.auth.admin.updateUserById(existing.id, { password, user_metadata: metadata });
      if (upd.error) return { ok: false, error: 'Could not sync auth session — contact admin' };
    } else {
      const create = await svc.auth.admin.createUser({
        email: u.email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      });
      if (create.error) return { ok: false, error: 'Could not create auth session — contact admin' };
    }
    // Retry the sign-in now that the auth user is in sync.
    const retry = await ssr.auth.signInWithPassword({ email: u.email, password });
    if (retry.error || !retry.data.session) return { ok: false, error: 'Authentication failed' };
    signed = retry.data;
  } else if (signed?.user) {
    // Even on the happy path, refresh user_metadata if anything (role, display
    // name, staff_user_id linkage) drifted since the last login.
    const cur = signed.user.user_metadata ?? {};
    const drift =
      cur.role !== metadata.role ||
      cur.staff_user_id !== metadata.staff_user_id ||
      cur.display_name !== metadata.display_name ||
      cur.username !== metadata.username;
    if (drift) {
      await svc.auth.admin.updateUserById(signed.user.id, { user_metadata: metadata });
    }
  }

  // Link the staff_users row to its auth.users twin on first sight so audit
  // triggers, RLS policies (when added), and human inspection all line up.
  const authUserId = signed?.user?.id;
  if (authUserId && u.auth_user_id !== authUserId) {
    await svc.from('staff_users').update({ auth_user_id: authUserId }).eq('id', u.id);
  }

  return { ok: true };
}

// Dev-only login bypass for testing roles without going through Supabase Auth.
// Controlled by AUTH_BYPASS env (default off — never ships on). Two forms:
//
//   AUTH_BYPASS=true                       → seeded admin@acumatica.local
//   AUTH_BYPASS=staff@acumatica.local      → any active staff_users row by email
//
// The second form is the role-testing workflow: edit .env.local, restart dev
// server, and the whole app sees you as that user. Used together with the
// matching middleware bypass triggered by the same env. Falls back to a
// synthetic admin payload if the target row doesn't exist (so the seed
// script's typo doesn't lock you out — you stay admin to fix it).
async function bypassAdminSession(): Promise<SessionPayload | null> {
  const targetEmail = bypassTargetEmail();
  if (!targetEmail) return null;
  const svc = createServiceClient();
  const { data } = await svc
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active')
    .eq('email', targetEmail)
    .maybeSingle();
  if (data && data.active) {
    return {
      staffUserId: data.id,
      email: data.email,
      acumaticaUserId: data.acumatica_user_id,
      displayName: data.display_name,
      role: data.role as Role,
      homeBranchId: data.home_branch_id,
    };
  }
  // Synthetic admin so a misspelt email or missing seed doesn't lock you out
  // — you stay admin, can see what's wrong, fix the env or seed, and retry.
  return {
    staffUserId: '00000000-0000-0000-0000-000000000000',
    email: targetEmail,
    acumaticaUserId: 'admin',
    displayName: `System Admin (bypass: ${targetEmail})`,
    role: 'admin',
    homeBranchId: null,
  };
}

/**
 * The canonical "who is making this request" answer. Reads the Supabase Auth
 * cookie, then enriches with the live staff_users row (role / home_branch_id /
 * display_name) so a role or branch change takes effect on the next request
 * without forcing a logout. Memoised per request via React's `cache()` so a
 * page + its loaders + its actions all share one DB read.
 */
export const currentSession = cache(async (): Promise<SessionPayload | null> => {
  // Bypass wins over any real Supabase Auth cookie. Otherwise a stale cookie
  // from a previous real login shadows the impersonation and you end up
  // testing as the wrong user without realising (e.g. cookie says EP000513 →
  // admin, AUTH_BYPASS says staff-osp2 → staff: the cookie wins silently and
  // you think the staff guard is broken when it isn't). Bypass is dev-only —
  // in production AUTH_BYPASS is unset so this short-circuit is dead code.
  const bypass = await bypassAdminSession();
  if (bypass) return bypass;

  const ssr = await createServerClient();
  const { data: { user } } = await ssr.auth.getUser();

  if (!user) return null;

  // Read the canonical row by auth_user_id (preferred) or fall back to email.
  // Email fallback handles the brief window after a brand-new login when
  // bridgeSupabaseAuthSession hasn't written staff_users.auth_user_id yet.
  const svc = createServiceClient();
  let { data: row } = await svc
    .from('staff_users')
    .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!row && user.email) {
    const r = await svc
      .from('staff_users')
      .select('id, email, acumatica_user_id, display_name, role, home_branch_id, active')
      .eq('email', user.email.toLowerCase())
      .maybeSingle();
    row = r.data;
  }
  if (!row || !row.active) return null;

  return {
    staffUserId: row.id,
    email: row.email,
    acumaticaUserId: row.acumatica_user_id,
    displayName: row.display_name,
    role: row.role as Role,
    homeBranchId: row.home_branch_id,
  };
});

export function isManager(s: SessionPayload | null): boolean {
  return !!s && (s.role === 'manager' || s.role === 'admin');
}

export function isAdmin(s: SessionPayload | null): boolean {
  return !!s && s.role === 'admin';
}

/** Accountant — staff-level POS access + edit financial master data (TX codes, payment methods, service categories). */
export function isAccountant(s: SessionPayload | null): boolean {
  return !!s && s.role === 'accountant';
}

/** Viewer — read-only access to everything a manager can see. No write operations. */
export function isViewer(s: SessionPayload | null): boolean {
  return !!s && s.role === 'viewer';
}

/** External hotel-front-desk booker — reservation-only; locked to the /book page. */
export function isExternalBooker(s: SessionPayload | null): boolean {
  return !!s && s.role === 'external_booker';
}

/** Can enter the /settings tree — admin, manager, accountant, or viewer. */
export function canAccessSettings(s: SessionPayload | null): boolean {
  return isManager(s) || isAccountant(s) || isViewer(s);
}

/**
 * Server-action guard: returns null when the caller is admin, or a friendly
 * error string otherwise.
 */
export async function requireAdmin(): Promise<string | null> {
  const s = await currentSession();
  return isAdmin(s) ? null : 'Admin permission required';
}

/** Same shape as requireAdmin but for manager+ (admin counts as manager). */
export async function requireManager(): Promise<string | null> {
  const s = await currentSession();
  return isManager(s) ? null : 'Manager permission required';
}

/** Guard for financial master data (TX codes, payment methods, service categories). */
export async function requireAdminOrAccountant(): Promise<string | null> {
  const s = await currentSession();
  return (isAdmin(s) || isAccountant(s)) ? null : 'Admin or Accountant permission required';
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
