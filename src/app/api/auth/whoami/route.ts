import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';

/**
 * TEMP diagnostic endpoint. Reports whether the SERVER sees the auth cookie and
 * a valid session on a client-initiated fetch (the same kind of request a
 * client-side navigation makes). Lets us tell "cookie not sent on client
 * requests" apart from "client router cache poisoned by a prefetch redirect".
 * Remove once resolved.
 */
export async function GET() {
  const jar = await cookies();
  const sbCookies = jar.getAll().filter((c) => c.name.startsWith('sb-')).map((c) => c.name);
  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return NextResponse.json({
    sbCookiesSeenByServer: sbCookies,
    hasUser: !!user,
    userId: user?.id ?? null,
    error: error?.message ?? null,
  });
}
