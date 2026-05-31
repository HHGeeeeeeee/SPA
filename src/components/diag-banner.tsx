'use client';

import { useEffect, useState } from 'react';

/**
 * TEMP on-screen diagnostic. Shows whether the browser currently holds the
 * Supabase auth cookie, right on the dashboard, so we can see if the cookie
 * survives after the page loads (without digging through server logs).
 * Remove once the Vercel session issue is resolved.
 */
export function DiagBanner() {
  const [jsInfo, setJsInfo] = useState('checking…');
  const [serverInfo, setServerInfo] = useState('checking…');

  useEffect(() => {
    const names = document.cookie
      .split(';')
      .map((c) => c.trim().split('=')[0])
      .filter(Boolean);
    setJsInfo(`jsCookies=${names.length ? names.join(',') : 'NONE'}`);

    // Ask the server, via a client-initiated fetch (same kind of request a
    // client-side nav makes), whether it sees the session.
    fetch('/api/auth/whoami', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) =>
        setServerInfo(
          `serverSeesSession=${d.hasUser ? 'YES' : 'NO'} · serverSbCookies=[${(d.sbCookiesSeenByServer || []).join(',') || 'NONE'}]${d.error ? ' · err=' + d.error : ''}`,
        ),
      )
      .catch((e) => setServerInfo('whoami fetch failed: ' + String(e)));
  }, []);

  return (
    <div className="sticky top-0 z-50 bg-amber-500 px-3 py-1 text-center text-xs font-mono font-bold text-black">
      DIAG · {jsInfo} · {serverInfo}
    </div>
  );
}
