import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

// Next.js 16 renamed the "middleware" file convention to "proxy" — same role,
// runs on every matched request before the page / route handler. We delegate
// to `updateSession` for the Supabase Auth refresh / idle-cap / route guard.
export async function proxy(req: NextRequest) {
  return await updateSession(req);
}

// Run on every path EXCEPT static assets, image optimisation, favicon, and
// API routes (those route handlers do their own auth via createServerClient).
// Mirrors ENGO's matcher.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
