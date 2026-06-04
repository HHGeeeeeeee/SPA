'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into the global top bar's `#topbar-slot` (right side,
 * before the search/notifications cluster). Use it from a page to hoist a
 * page-specific control — e.g. the Calendar branch switcher — into the
 * header. Renders nothing until the slot exists on the client.
 */
export function TopBarPortal({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById('topbar-slot'));
  }, []);
  return slot ? createPortal(children, slot) : null;
}