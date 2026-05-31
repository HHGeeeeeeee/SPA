'use client';

import { useEffect, useState } from 'react';

/**
 * TEMP on-screen diagnostic. Shows whether the browser currently holds the
 * Supabase auth cookie, right on the dashboard, so we can see if the cookie
 * survives after the page loads (without digging through server logs).
 * Remove once the Vercel session issue is resolved.
 */
export function DiagBanner() {
  const [info, setInfo] = useState('checking…');

  useEffect(() => {
    const read = () => {
      const names = document.cookie
        .split(';')
        .map((c) => c.trim().split('=')[0])
        .filter(Boolean);
      const sb = names.filter((n) => n.startsWith('sb-'));
      setInfo(
        `sbCookie=${sb.length ? sb.join(',') : 'NONE'} · allCookies=${names.length ? names.join(',') : 'NONE'}`,
      );
    };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sticky top-0 z-50 bg-amber-500 px-3 py-1 text-center text-xs font-mono font-bold text-black">
      DIAG · {info}
    </div>
  );
}
