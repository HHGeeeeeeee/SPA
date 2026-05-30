import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_IDLE_SECONDS } from '@/lib/session';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Supabase SSR middleware — same pattern as ENGO Back Office. Three jobs:
 *
 *  1. Refresh the Supabase Auth token if the access_token is about to expire.
 *     `supabase.auth.getUser()` triggers the refresh and the new tokens land
 *     in the response cookies via the `setAll` shim below.
 *  2. Cap the cookie maxAge to SESSION_IDLE_SECONDS (3h). Supabase's default is
 *     the refresh-token lifetime (~30 days); we want idle timeout instead.
 *     Continuous activity → cookie rolling, never expires. Idle 3h+ → invalid.
 *  3. Route-protection redirects:
 *       - no auth user + not on /login  → /login
 *       - has auth user + on /login     → /
 *
 * Skipped entirely when Supabase isn't configured (dev / setup phase) so the
 * AUTH_BYPASS path in currentSession still works for local development.
 */
export async function updateSession(request: NextRequest) {
  // Dev / preview bypass — same triad as ENGO Back Office plus our explicit
  // AUTH_BYPASS escape hatch. Any of these triggers middleware to let every
  // request through so the AUTH_BYPASS fallback in currentSession() can
  // synthesise a session for local development.
  //
  //   - AUTH_BYPASS=true               -> explicit local dev opt-in
  //   - Supabase env missing/placeholder -> not configured yet
  //   - ACUMATICA_BASE_URL missing       -> ERP not wired (preview / staging)
  if (
    process.env.AUTH_BYPASS === 'true'
    || !SUPABASE_URL
    || SUPABASE_URL.includes('placeholder')
    || !SUPABASE_PUBLISHABLE_KEY
    || !process.env.ACUMATICA_BASE_URL
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror cookies onto the request (so getUser() below sees them) AND
        // queue them onto the response with a capped maxAge for idle timeout.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          const capped = {
            ...options,
            maxAge:
              options?.maxAge != null
                ? Math.min(options.maxAge, SESSION_IDLE_SECONDS)
                : SESSION_IDLE_SECONDS,
          };
          supabaseResponse.cookies.set(name, value, capped);
        });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const onLogin = path.startsWith('/login');

  if (!user && !onLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user && onLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
