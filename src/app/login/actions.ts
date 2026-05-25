'use server';

import { z } from 'zod';

import { authenticate } from '@/lib/auth';
import { setSessionCookie, setAcuSessionCookie } from '@/lib/session';

const schema = z.object({
  // Acumatica login name (may be an email). Falls back to the local email login
  // when Acumatica isn't configured.
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function login(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter your username and password' };
  const r = await authenticate(parsed.data.username, parsed.data.password);
  if (!r.ok) return { ok: false, error: r.error };
  await setSessionCookie(r.session);
  // Store the ERP session cookie so GL posts run under this user's Acumatica identity.
  if (r.acuCookie) await setAcuSessionCookie(r.acuCookie);
  return { ok: true };
}
