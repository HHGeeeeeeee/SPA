'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';

import { releaseBed } from '@/app/(dashboard)/sales-orders/actions';

// Post-service bed-cleanup block on the Station day timeline. Distinct colour
// from the active/done service blocks; clicking marks the bed ready early.
export function CleanupSegment({
  itemId,
  left,
  width,
  top,
  height,
  label,
}: {
  itemId?: string;
  left: number;
  width: number;
  top: number;
  height: number;
  label: string;
}) {
  const [pending, start] = useTransition();
  function release() {
    if (!itemId) return;
    start(async () => {
      const r = await releaseBed(itemId);
      if (r.ok) toast.success('Bed marked ready');
      else toast.error(r.error);
    });
  }
  return (
    <button
      type="button"
      onClick={release}
      disabled={pending || !itemId}
      title={`${label} — click to mark the bed ready now`}
      className="absolute flex items-center justify-center rounded border border-dashed border-zinc-500/50 bg-zinc-400/75 px-1 overflow-hidden whitespace-nowrap text-[10px] font-bold leading-tight text-zinc-900 hover:bg-zinc-400 disabled:cursor-default dark:text-zinc-950"
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
    >
      clean
    </button>
  );
}
