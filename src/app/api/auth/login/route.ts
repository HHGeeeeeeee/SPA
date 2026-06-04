import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticate } from '@/lib/auth';
import { setAcuSessionCookie } from '@/lib/session';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Login via a Route Handler (not a Server Action).
 *
 * Why a route handler: setting the Supabase auth cookie from a Server Action
 * never survived to the browser on Vercel, and writing it client-side fought
 * the server middleware (token rotation clobbered the cookie). Route handlers
 * set cookies reliably, and the middleware matcher already excludes `/api/`,
 * so nothing here interferes with the Set-Cookie.
 *
 * authenticate() validates the credentials (ERP / local bcrypt) and bridges
 * the Supabase Auth session; the SSR cookie shim writes the session cookie onto
 * this response, which the browser then sends on every subsequent request.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Enter your username and password' }, { status: 400 });
  }

  const r = await authenticate(parsed.data.username, parsed.data.password);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 401 });
  }

  if (r.acuCookie) await setAcuSessionCookie(r.acuCookie);

  return NextResponse.json({ ok: true });
}
