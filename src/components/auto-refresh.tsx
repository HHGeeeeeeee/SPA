'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Periodically re-fetches the page's server data (router.refresh) so boards
 * pick up changes made on other terminals without a manual reload. Client
 * state (open dialogs, form input) survives a refresh — only server-rendered
 * props update.
 *
 * A tick is skipped while the tab is hidden, or while the user is mid-press /
 * mid-drag (dnd-kit drags ride pointerdown→pointerup; the lineup drag is
 * native HTML5 dragstart→dragend, during which pointer events are suppressed)
 * — refreshing then would yank the board out from under the drag. Skipped
 * ticks are simply caught by the next interval; returning to a hidden tab
 * refreshes immediately instead of waiting out the remainder.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let pointerHeld = false;
    let nativeDrag = false;
    const pointerDown = () => { pointerHeld = true; };
    const pointerUp = () => { pointerHeld = false; };
    const dragStart = () => { nativeDrag = true; pointerHeld = false; };
    const dragEnd = () => { nativeDrag = false; };

    window.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    window.addEventListener('dragstart', dragStart);
    window.addEventListener('dragend', dragEnd);
    window.addEventListener('drop', dragEnd);

    const busy = () => document.visibilityState !== 'visible' || pointerHeld || nativeDrag;
    const id = setInterval(() => { if (!busy()) router.refresh(); }, intervalMs);
    const onVisible = () => { if (!busy()) router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      window.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('dragstart', dragStart);
      window.removeEventListener('dragend', dragEnd);
      window.removeEventListener('drop', dragEnd);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, intervalMs]);

  return null;
}
