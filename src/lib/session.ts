import 'server-only';
import { cookies } from 'next/headers';

/**
 * Auth uses Supabase Auth (the `sb-{ref}-auth-token` cookie set by
 * `@supabase/ssr`). The session itself isn't read or written here — see
 * `currentSession` in `@/lib/auth` for the read path and `signInWithPassword`
 * in the login action for the write path.
 *
 * This module owns two things that DON'T fit Supabase Auth:
 *   - The Acumatica REST session cookie we got back from /entity/auth/login.
 *     We keep it httpOnly server-side and replay it when posting GL / AP so
 *     every ERP write is attributed to the user's own Acumatica identity.
 *   - The SessionPayload shape that server actions consume.
 */

// Acumatica REST API session cookie — passed from /entity/auth/login Set-Cookie.
// Server-side reads this when posting GL / querying ERP so every action is
// attributed to the user's own Acumatica identity (not a service account).
export const ACU_SESSION_COOKIE = 'acu_session';

// Idle timeout: 3 hours rolling. The middleware caps every Supabase cookie
// refresh to this maxAge, so continuous activity keeps the session alive and
// 3h of idleness expires it. Matches ENGO Back Office.
export const SESSION_IDLE_SECONDS = 3 * 60 * 60;

export interface SessionPayload {
  staffUserId: string;
  email: string;
  acumaticaUserId: string;
  displayName: string | null;
  role: 'admin' | 'manager' | 'accountant' | 'staff' | 'viewer' | 'external_booker';
  homeBranchId: string | null;
}

export async function setAcuSessionCookie(cookie: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACU_SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_IDLE_SECONDS,
  });
}

export async function readAcuSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACU_SESSION_COOKIE)?.value ?? null;
}

export async function clearAcuSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACU_SESSION_COOKIE);
}
