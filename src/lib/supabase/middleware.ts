import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_IDLE_SECONDS } from '@/lib/session';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Local copy of the bypass check (the canonical one is in @/lib/auth; we
// inline it here to avoid the middleware pulling in server-only modules).
function isBypassActive(): boolean {
  const v = (process.env.AUTH_BYPASS ?? '').trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
}

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
  // Dev bypass — let every request through so the AUTH_BYPASS fallback in
  // currentSession() can synthesise a session for local development.
  //
  //   - AUTH_BYPASS any truthy value       -> explicit local dev opt-in
  //     ("true" for the seeded admin, or an email like
  //      "staff-osp1@acumatica.local" for role-switching).
  //   - Supabase env missing / "placeholder" -> not configured yet
  //
  // NOTE: this deliberately does NOT key off ACUMATICA_BASE_URL. Token refresh
  // is Supabase's job and must run on every request once Supabase is wired,
  // regardless of whether the ERP is connected — otherwise the access token
  // expires with nothing to renew it, currentSession() in Server Components
  // (which can't persist a refreshed cookie) silently goes null, and the user
  // gets bounced to /login or hit with "not signed in". The ERP being optional
  // (setup / preview phase) is orthogonal to keeping the auth session alive.
  if (
    isBypassActive()
    || !SUPABASE_URL
    || SUPABASE_URL.includes('placeholder')
    || !SUPABASE_PUBLISHABLE_KEY
  ) {
    return NextResponse.next({ request });
  }

  // Let Next.js Server Actions through untouched. They POST to the current
  // route with a `next-action` header; running the Supabase client here calls
  // getUser(), which — for a request that has no (or a stale) session, e.g. the
  // login POST itself — emits cookie-clearing Set-Cookie headers on our
  // response. Those then clobber the brand-new session cookie the login action
  // is trying to write, so it never reaches the browser and every following
  // request looks unauthenticated (→ bounced to /login). The page hosting the
  // action is already auth-guarded and actions do their own permission checks,
  // so skipping the session plumbing for action POSTs is safe.
  if (request.headers.get('next-action')) {
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

  const { data: { user }, error: getUserError } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const onLogin = path.startsWith('/login');

  // TEMP DIAGNOSTIC (remove once resolved): the middleware is the gate that
  // bounces to /login. Log what it sees so we can tell why getUser() here can
  // disagree with currentSession() on the same cookie.
  const sbCookies = request.cookies.getAll().filter((c) => c.name.startsWith('sb-')).map((c) => c.name);
  const allCookieNames = request.cookies.getAll().map((c) => c.name);
  const isPrefetch =
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-middleware-prefetch') === '1';
  console.error('[diag middleware]', JSON.stringify({
    path,
    method: request.method,
    isPrefetch,
    sbCookies,
    allCookieNames,
    hasUser: !!user,
    userId: user?.id ?? null,
    getUserError: getUserError?.message ?? null,
    willBounce: !user && !onLogin,
  }));

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
