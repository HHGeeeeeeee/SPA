import 'server-only';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

/**
 * The kiosk "armed" state. A tablet is armed once by staff (pick branch + branch
 * passcode); after that it loops the public intake form for guests with no
 * further auth. The armed state is a signed, httpOnly cookie so a guest can't
 * read it, forge a different branch, or arm the kiosk without the passcode.
 *
 * Signed with SUPABASE_SECRET_KEY (already server-only + high entropy) so no new
 * env var is needed. The only capability this cookie grants is "insert an
 * UNBOUND intake_consent for this branch" — it reads nothing and touches no
 * order, so the blast radius of a leaked/forged cookie is junk pending forms.
 */

export const KIOSK_COOKIE = 'kiosk_branch';
// Long-lived: a reception tablet stays armed across reboots until staff exit.
const KIOSK_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface KioskContext {
  branchId: string;
  branchCode: string;
  branchName: string;
}

function secretKey(): Uint8Array {
  const s = process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error('SUPABASE_SECRET_KEY is not set (required to sign kiosk cookie)');
  return new TextEncoder().encode(s);
}

export async function setKioskCookie(ctx: KioskContext): Promise<void> {
  const token = await new SignJWT({ ...ctx })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_MAX_AGE_SECONDS}s`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: KIOSK_MAX_AGE_SECONDS,
  });
}

export async function readKioskContext(): Promise<KioskContext | null> {
  const jar = await cookies();
  const token = jar.get(KIOSK_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.branchId === 'string' &&
      typeof payload.branchCode === 'string' &&
      typeof payload.branchName === 'string'
    ) {
      return { branchId: payload.branchId, branchCode: payload.branchCode, branchName: payload.branchName };
    }
    return null;
  } catch {
    return null; // expired / tampered
  }
}

export async function clearKioskCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(KIOSK_COOKIE);
}
