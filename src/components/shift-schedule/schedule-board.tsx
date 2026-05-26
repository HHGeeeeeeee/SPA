'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';

import { Card } from '@/components/ui/card';
import { NewReservationDialog, type ReservationItem } from '@/components/reservations/new-reservation-dialog';
import { ReservationConvertButton } from '@/components/shift-schedule/reservation-convert-button';
import { placeReservationOnBed, moveScheduledOrderItem } from '@/app/(dashboard)/shift-schedule/actions';

export interface BoardBed { id: string; name: string }
export type BlockVariant = 'pending' | 'confirmed' | 'scheduled' | 'in_service' | 'completed';
export interface BoardBlock {
  key: string;
  kind: 'reservation' | 'order';
  refId: string;
  bedId: string | null; // null = floating (top lane), not yet on a bed
  line1: string;
  line2?: string;
  startMin: number;
  endMin: number;
  durationMin: number;
  variant: BlockVariant;
  draggable: boolean;
  orderId?: string;
}
// Option data forwarded to NewReservationDialog for click-to-add.
interface BranchOpt { id: string; code: string; name: string; businessUnitIds: string[] }
interface SourceOpt { id: string; code: string; name: string; phone_required: boolean }
interface CategoryOpt { id: string; code: string; name: string; businessUnitIds: string[]; requiredResourceType: string | null }
interface ItemOpt { id: string; name: string; group: string; categoryId: string; durationMinutes: number | null }
export interface BoardDialogData {
  branches: BranchOpt[];
  sources: SourceOpt[];
  serviceCategories: CategoryOpt[];
  serviceItems: ItemOpt[];
}

const PX_PER_HOUR = 160;
const PX_PER_MIN = PX_PER_HOUR / 60;
const LANE_H = 56;
const LABEL_W = 160;

const snap15 = (min: number) => Math.round(min / 15) * 15;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const makeIso = (day: string, min: number) => `${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+08:00`;

// Greedy lane packing so overlapping blocks stack instead of covering each other.
function assignLanes(blocks: { startMin: number; endMin: number }[]): { lanes: number[]; count: number } {
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[a].startMin - blocks[b].startMin);
  const laneEnds: number[] = [];
  const lanes = new Array(blocks.length).fill(0);
  for (const i of order) {
    let placed = laneEnds.findIndex((e) => blocks[i].startMin >= e);
    if (placed === -1) { placed = laneEnds.length; laneEnds.push(0); }
    lanes[i] = placed;
    laneEnds[placed] = blocks[i].endMin;
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

const VARIANT_CLASS: Record<BlockVariant, string> = {
  pending: 'border border-dashed border-amber-500/70 bg-amber-500/15 text-amber-950 dark:text-amber-100',
  confirmed: 'border border-dashed border-violet-500/70 bg-violet-500/25 text-violet-950 dark:text-violet-100',
  scheduled: 'border border-primary/50 bg-primary/30 text-foreground',
  in_service: 'bg-blue-500/80 text-white',
  completed: 'bg-muted text-muted-foreground line-through',
};

function BlockView({ block, windowStartMin, onOpen }: { block: BoardBlock; windowStartMin: number; onOpen: (b: BoardBlock) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.key,
    data: { block },
    disabled: !block.draggable,
  });
  const left = (block.startMin - windowStartMin) * PX_PER_MIN;
  const width = Math.max(28, (block.endMin - block.startMin) * PX_PER_MIN);
  const style: React.CSSProperties = {
    left,
    width,
    top: 3,
    height: LANE_H - 6,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : 5,
    opacity: isDragging ? 0.85 : 1,
    touchAction: 'none',
  };
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onOpen(block); }}
      style={style}
      className={`absolute rounded px-1.5 flex flex-col justify-center overflow-hidden text-[10px] leading-tight ${block.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${VARIANT_CLASS[block.variant]}`}
      title={`${block.line1}${block.line2 ? ` · ${block.line2}` : ''} · ${hhmm(block.startMin)}–${hhmm(block.endMin)}`}
    >
      <span className="truncate font-bold">{block.line1}</span>
      {block.line2 && <span className="truncate font-semibold opacity-90">{block.line2}</span>}
      <span className="truncate font-semibold tabular-nums opacity-80">{hhmm(block.startMin)}–{hhmm(block.endMin)}</span>
    </div>
  );
}

function BedRow({
  bed, blocks, windowStartMin, trackWidth, hours, nowMin, onOpen, onEmptyClick,
}: {
  bed: BoardBed;
  blocks: BoardBlock[];
  windowStartMin: number;
  trackWidth: number;
  hours: number[];
  nowMin: number | null;
  onOpen: (b: BoardBlock) => void;
  onEmptyClick: (bedId: string, min: number, clientX: number, trackLeft: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bed:${bed.id}` });
  const { lanes, count } = assignLanes(blocks);
  return (
    <div className="flex border-b border-border last:border-0">
      <div className="w-40 shrink-0 p-2 text-center flex flex-col justify-center sticky left-0 z-20 bg-card">
        <div className="font-semibold text-sm">{bed.name}</div>
      </div>
      <div
        ref={setNodeRef}
        className={`relative flex-1 my-1 ${isOver ? 'bg-primary/5' : ''}`}
        style={{ height: count * LANE_H, minWidth: trackWidth }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const min = snap15(windowStartMin + (e.clientX - rect.left) / PX_PER_MIN);
          onEmptyClick(bed.id, min, e.clientX, rect.left);
        }}
      >
        {hours.map((h) => (
          <div key={h} className="absolute top-0 bottom-0 border-l border-border/60" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN }} />
        ))}
        {hours.slice(0, -1).flatMap((h) => [15, 30, 45].map((q) => (
          <div key={`${h}-${q}`} className="absolute top-0 bottom-0 border-l border-border/20" style={{ left: (h * 60 + q - windowStartMin) * PX_PER_MIN }} />
        )))}
        {blocks.map((b, i) => (
          <div key={b.key} className="absolute inset-x-0" style={{ top: lanes[i] * LANE_H }}>
            <BlockView block={b} windowStartMin={windowStartMin} onOpen={onOpen} />
          </div>
        ))}
        {nowMin != null && nowMin >= windowStartMin && (
          <div className="absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: (nowMin - windowStartMin) * PX_PER_MIN }} />
        )}
      </div>
    </div>
  );
}

export function ScheduleBoard({
  branchId, day, beds, blocks, windowStartMin, windowEndMin, nowMin, dialog,
}: {
  branchId: string;
  day: string;
  beds: BoardBed[];
  blocks: BoardBlock[];
  windowStartMin: number;
  windowEndMin: number;
  nowMin: number | null;
  dialog: BoardDialogData;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const suppressClick = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Click-to-add: a small menu at the clicked cell, then the prefilled dialog.
  const [menu, setMenu] = useState<{ bedId: string; min: number; left: number; top: number } | null>(null);
  const [addKey, setAddKey] = useState(0);
  const [add, setAdd] = useState<{ bedId: string; min: number; confirmed: boolean } | null>(null);
  // Tap a reservation block → confirm / convert it (seat the guest).
  const [convert, setConvert] = useState<{ reservationId: string; guest: string; pending: boolean } | null>(null);

  const total = Math.max(60, windowEndMin - windowStartMin);
  const trackWidth = Math.round((total / 60) * PX_PER_HOUR);
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  const floating = blocks.filter((b) => b.bedId === null);
  const blocksByBed = new Map<string, BoardBlock[]>();
  for (const b of blocks) if (b.bedId) blocksByBed.set(b.bedId, [...(blocksByBed.get(b.bedId) ?? []), b]);

  function openBlock(b: BoardBlock) {
    if (b.kind === 'order' && b.orderId) router.push(`/sales-orders/${b.orderId}`);
    else if (b.kind === 'reservation') setConvert({ reservationId: b.refId, guest: b.line1, pending: b.variant === 'pending' });
  }

  function onEmptyClick(bedId: string, min: number, clientX: number, trackLeft: number) {
    if (Date.now() - suppressClick.current < 250) return; // a drag just ended
    setMenu({ bedId, min, left: clientX - trackLeft + LABEL_W, top: 0 });
  }

  function onDragEnd(e: DragEndEvent) {
    suppressClick.current = Date.now();
    const block = e.active.data.current?.block as BoardBlock | undefined;
    const overId = e.over?.id as string | undefined;
    if (!block || !overId || !overId.startsWith('bed:')) return;
    const bedId = overId.slice(4);
    const deltaMin = Math.round(e.delta.x / PX_PER_MIN);
    const newStart = Math.min(windowEndMin - 15, Math.max(windowStartMin, snap15(block.startMin + deltaMin)));
    if (bedId === block.bedId && newStart === block.startMin) return; // no-op
    startTransition(async () => {
      const r = block.kind === 'reservation'
        ? await placeReservationOnBed({ reservation_id: block.refId, bed_id: bedId, start_min: newStart, day })
        : await moveScheduledOrderItem({ item_id: block.refId, bed_id: bedId, start_min: newStart, day });
      if (r.ok) { toast.success('Schedule updated'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  const addStartIso = add ? makeIso(day, add.min) : '';
  const synthetic: ReservationItem | undefined = add
    ? {
        id: 'prefill', branch_id: branchId, source_id: null, service_category_ids: [],
        guest_name: '', guest_phone: null, pax: 1, gender_preference: null,
        service_location_type: 'on_site', note: null,
        desired_service_start: addStartIso,
        desired_service_end: new Date(Date.parse(addStartIso) + 60 * 60000).toISOString(),
        resource_ids: [add.bedId], seat_together: false, service_item_id: null,
      }
    : undefined;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragStart={() => setMenu(null)}>
      <Card className="relative p-0 overflow-auto max-h-[calc(100vh-16rem)]">
        <div style={{ minWidth: LABEL_W + trackWidth }}>
          {/* hour + 15-min ruler */}
          <div className="flex border-b border-border sticky top-0 z-30 bg-muted">
            <div className="w-40 shrink-0 p-2 flex items-center justify-center text-center text-xs font-bold text-muted-foreground sticky left-0 z-40 bg-muted">Station</div>
            <div className="relative h-9" style={{ minWidth: trackWidth }}>
              {hours.slice(0, -1).map((h) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 flex items-center justify-center text-xs font-bold tabular-nums border-l border-border/50"
                  style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN, width: PX_PER_HOUR }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
              {hours.slice(0, -1).flatMap((h) => [15, 30, 45].map((q) => (
                <div key={`${h}-${q}`} className="absolute bottom-0 h-2 border-l border-border/30" style={{ left: (h * 60 + q - windowStartMin) * PX_PER_MIN }} />
              )))}
              {nowMin != null && nowMin >= windowStartMin && (
                <div className="absolute top-0 bottom-0 z-10 -translate-x-1/2 flex flex-col items-center" style={{ left: (nowMin - windowStartMin) * PX_PER_MIN }}>
                  <span className="rounded bg-red-500 px-1 text-[9px] font-bold leading-tight text-white">{hhmm(nowMin)}</span>
                </div>
              )}
            </div>
          </div>

          {/* floating reservations to place — drag down onto a bed */}
          {floating.length > 0 && (() => {
            const { lanes, count } = assignLanes(floating);
            return (
              <div className="flex border-b-2 border-violet-500/30 bg-violet-500/5">
                <div className="w-40 shrink-0 p-2 text-center flex flex-col justify-center sticky left-0 z-20 bg-card">
                  <div className="font-semibold text-sm text-violet-700 dark:text-violet-300">To place</div>
                  <div className="font-bold text-xs text-muted-foreground">drag onto a bed</div>
                </div>
                <div className="relative my-1" style={{ height: count * LANE_H, minWidth: trackWidth }}>
                  {hours.map((h) => (
                    <div key={h} className="absolute top-0 bottom-0 border-l border-border/60" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN }} />
                  ))}
                  {floating.map((b, i) => (
                    <div key={b.key} className="absolute inset-x-0" style={{ top: lanes[i] * LANE_H }}>
                      <BlockView block={b} windowStartMin={windowStartMin} onOpen={openBlock} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {beds.length === 0 ? (
            <div className="p-8 text-center text-sm font-semibold text-muted-foreground">No active beds for this branch.</div>
          ) : (
            beds.map((bed) => (
              <BedRow
                key={bed.id}
                bed={bed}
                blocks={blocksByBed.get(bed.id) ?? []}
                windowStartMin={windowStartMin}
                trackWidth={trackWidth}
                hours={hours}
                nowMin={nowMin}
                onOpen={openBlock}
                onEmptyClick={onEmptyClick}
              />
            ))
          )}
        </div>

        {/* click-to-add menu */}
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
            <div
              className="absolute z-50 rounded-lg border border-border bg-card p-1 shadow-lg flex flex-col"
              style={{ left: Math.min(menu.left, LABEL_W + trackWidth - 160), top: 44 }}
            >
              <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground">
                {beds.find((b) => b.id === menu.bedId)?.name} · {hhmm(menu.min)}
              </div>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-left text-sm font-semibold hover:bg-accent"
                onClick={() => { setAdd({ bedId: menu.bedId, min: menu.min, confirmed: false }); setAddKey((k) => k + 1); setMenu(null); }}
              >
                New reservation
              </button>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-left text-sm font-semibold hover:bg-accent"
                onClick={() => { setAdd({ bedId: menu.bedId, min: menu.min, confirmed: true }); setAddKey((k) => k + 1); setMenu(null); }}
              >
                Walk-in (confirmed)
              </button>
            </div>
          </>
        )}
      </Card>

      {add && synthetic && (
        <NewReservationDialog
          key={addKey}
          branches={dialog.branches}
          sources={dialog.sources}
          serviceCategories={dialog.serviceCategories}
          serviceItems={dialog.serviceItems}
          reservation={synthetic}
          prefillConfirmed={add.confirmed}
          open
          onOpenChange={(o) => { if (!o) { setAdd(null); router.refresh(); } }}
        />
      )}

      {convert && (
        <ReservationConvertButton
          triggerless
          reservationId={convert.reservationId}
          guest={convert.guest}
          pending={convert.pending}
          open
          onOpenChange={(o) => { if (!o) setConvert(null); }}
        />
      )}
    </DndContext>
  );
}
