import { NextResponse, type NextRequest } from 'next/server';

import { clearSessionCookie, readAcuSessionCookie } from '@/lib/session';
import { acumaticaLogout } from '@/lib/acumatica';

export async function GET(req: NextRequest) {
  // Close the Acumatica session too (best-effort) before clearing local cookies.
  await acumaticaLogout(await readAcuSessionCookie());
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', req.url));
}
