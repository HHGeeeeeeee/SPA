'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { authenticate } from '@/lib/auth';
import { setAcuSessionCookie } from '@/lib/session';

const schema = z.object({
  // Acumatica login name (may be an email). Falls back to the local email
  // login when Acumatica isn't configured.
  username: z.string().min(1),
  password: z.string().min(1),
  // Optional post-login destination (must be a same-site absolute path).
  next: z.string().optional(),
});

export async function login(
  input: unknown,
): Promise<{ ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter your username and password' };
  const r = await authenticate(parsed.data.username, parsed.data.password);
  if (!r.ok) return { ok: false, error: r.error };
  // The Supabase Auth cookies are already on the response — written by the
  // SSR client's cookie shim during signInWithPassword. Only the ACU session
  // cookie still needs an explicit write.
  if (r.acuCookie) await setAcuSessionCookie(r.acuCookie);

  // Navigate via a server-side redirect rather than returning {ok:true} for the
  // client to router.replace(). The redirect response carries the freshly
  // written Set-Cookie atomically, so the browser commits the auth cookie
  // before the next request. A client-side navigation can race the cookie
  // write (notably on Vercel), leaving the session cookie unset and bouncing
  // the user straight back to /login. redirect() throws NEXT_REDIRECT, so it
  // must stay outside any try/catch — only the failure paths above return.
  const next = parsed.data.next;
  redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
}
