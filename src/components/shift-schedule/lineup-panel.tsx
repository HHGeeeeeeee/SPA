'use client';

import { useEffect, useRef, useState } from 'react';
import { GripVertical, ArrowDownToLine, X, ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LineupTherapist {
  name: string;
  positionCode: string | null;
  /** Rostered today — off-shift people show an "off" chip. */
  onShift: boolean;
  /** Has an absence block today — shown with an "absent" chip. */
  blocked: boolean;
}

export const LINEUP_DND_MIME = 'application/x-hhg-therapist';
const COLLAPSE_KEY = 'hhg-spa:lineup:collapsed';

const POSITION_LABEL: Record<string, string> = {
  MASSAGE_THERAPIST: 'Massage', MASSAGE_NEWBI: 'Newbi', HAIR_STYLIST: 'Hair', NAIL_TECHNICIAN: 'Nail',
};

/**
 * Compact, order-only line-up list for the board's left column (under the
 * Unallocated rail). Collapsed by default — expand to edit. State lives in the
 * parent (ScheduleBoard); this is purely presentational. Add a therapist by
 * dragging their board row here (drops onto the collapsed header expand it too)
 * or the row's "+ line-up" icon; reorder by dragging items; commit with Save.
 */
export function LineupList({
  order, byId, dirty, pending,
  onReorder, onRemove, onToBack, onAdd, onSave, onReset, onClear,
}: {
  order: string[];
  byId: Map<string, LineupTherapist>;
  dirty: boolean;
  pending: boolean;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onToBack: (id: string) => void;
  onAdd: (id: string) => void;
  onSave: () => void;
  onReset: () => void;
  onClear: () => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    // Load after mount so SSR markup stays stable (mirrors the board's toggles).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) !== '0'); } catch { /* defensive */ }
  }, []);
  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try { window.localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* defensive */ }
  };
  const posLabel = (code: string | null) => (code ? POSITION_LABEL[code] ?? code.replace(/_/g, ' ') : '');

  // Accept a therapist dragged from a board row (carries its id in dataTransfer).
  // Dropping on the collapsed panel expands it so the result is visible.
  const onDropFromBoard = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(LINEUP_DND_MIME);
    if (id) { e.preventDefault(); onAdd(id); setCollapsedPersist(false); }
  };

  return (
    <div
      className={cn('rounded-lg border bg-card', dirty ? 'border-primary/60' : 'border-border')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(LINEUP_DND_MIME)) e.preventDefault(); }}
      onDrop={onDropFromBoard}
    >
      <div className="flex items-center justify-between gap-1 px-2.5 py-2">
        <button type="button" onClick={() => setCollapsedPersist(!collapsed)} className="flex min-w-0 items-center gap-1 text-xs font-bold">
          {collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
          Line-up <span className="font-medium text-muted-foreground">{order.length || ''}</span>
          {dirty && collapsed && <span className="size-1.5 rounded-full bg-primary" title="Unsaved changes" />}
        </button>
        {dirty ? (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={pending} onClick={onReset}>Reset</Button>
            <Button size="sm" className="h-6 px-2 text-[10px]" disabled={pending} onClick={onSave}>Save</Button>
          </div>
        ) : (
          !collapsed && order.length > 0 && <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground" disabled={pending} onClick={onClear}>Clear</Button>
        )}
      </div>

      {!collapsed && (
        order.length === 0 ? (
          <p className="border-t border-border px-2.5 py-5 text-center text-[10px] font-semibold italic leading-snug text-muted-foreground/70">
            Drag a therapist row here, or use a row&apos;s + line-up.
          </p>
        ) : (
          <ol className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto border-t border-border p-1.5">
            {order.map((id, i) => {
              const t = byId.get(id);
              if (!t) return null;
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={(e) => { dragIndex.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex.current != null) onReorder(dragIndex.current, i); dragIndex.current = null; }}
                  className={cn(
                    'rounded border border-border bg-card px-1.5 py-1 text-[12px]',
                    (t.blocked || !t.onShift) && 'opacity-55',
                  )}
                >
                  {/* Line 1: grip + number + full-width name. */}
                  <div className="flex items-center gap-1">
                    <GripVertical className="size-3 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
                    <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                  </div>
                  {/* Line 2: position tag + status chip on the left, actions on the right. */}
                  <div className="mt-0.5 flex items-center gap-1 pl-5">
                    {t.positionCode && <span className="shrink-0 text-[9px] font-medium text-muted-foreground">{posLabel(t.positionCode)}</span>}
                    {t.blocked && <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-700 dark:text-amber-400">absent</span>}
                    {!t.onShift && !t.blocked && <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-bold text-muted-foreground">off</span>}
                    <span className="flex-1" />
                    <button type="button" disabled={pending} onClick={() => onToBack(id)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Send to back"><ArrowDownToLine className="size-3.5" /></button>
                    <button type="button" disabled={pending} onClick={() => onRemove(id)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Remove"><X className="size-3.5" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
        )
      )}
    </div>
  );
}