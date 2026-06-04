import { NextResponse, type NextRequest } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { readAcuSessionCookie, clearAcuSessionCookie } from '@/lib/session';
import { acumaticaLogout } from '@/lib/acumatica';

/**
 * Logout — three things to clean up:
 *   1. Acumatica REST session (best-effort, the ERP times it out anyway).
 *   2. Supabase Auth session (writes deletion cookies via the SSR client).
 *   3. The local httpOnly ACU session cookie.
 *
 * POST-only ON PURPOSE. Logout mutates state (clears the session cookie), so
 * it must never be reachable by a GET. A GET handler here was the root cause of
 * the "log in, then get bounced straight back to /login" bug on Vercel: the
 * Sign Out link in the sidebar was a Next.js <Link>, and the App Router
 * auto-prefetches every visible link — including GET /api/auth/logout — which
 * silently signed the user out milliseconds after they landed on the dashboard.
 * The Sign Out control is now a button that fetch()es this endpoint with POST,
 * so it can't be prefetched or triggered by accidental navigation.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  await acumaticaLogout(await readAcuSessionCookie());

  const ssr = await createServerClient();
  await ssr.auth.signOut();

  await clearAcuSessionCookie();

  return NextResponse.redirect(new URL('/login', req.url));
}
