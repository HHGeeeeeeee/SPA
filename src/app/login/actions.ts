'use server';

import { z } from 'zod';

import { authenticate } from '@/lib/auth';
import { setAcuSessionCookie } from '@/lib/session';

const schema = z.object({
  // Acumatica login name (may be an email). Falls back to the local email
  // login when Acumatica isn't configured.
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function login(
  input: unknown,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter your username and password' };
  const r = await authenticate(parsed.data.username, parsed.data.password);
  if (!r.ok) return { ok: false, error: r.error };

  // The ERP session cookie still needs an explicit server-side write.
  if (r.acuCookie) await setAcuSessionCookie(r.acuCookie);

  // We do NOT rely on the server-side signInWithPassword cookie here: writing
  // the Supabase auth cookie from a Server Action proved unreliable on Vercel
  // (the Set-Cookie didn't survive to the browser, so every later request
  // looked unauthenticated and bounced to /login). Instead the server has now
  // validated credentials and ensured the Supabase Auth user exists with the
  // synced password (via authenticate()'s bridge); the *browser* completes the
  // sign-in, which writes the session cookie client-side reliably. We just hand
  // back the email to sign in with.
  return { ok: true, email: r.email };
}
