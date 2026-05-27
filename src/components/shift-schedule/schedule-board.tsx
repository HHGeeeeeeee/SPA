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
  prepMin: number; // bed turnover before the service (drawn as a buffer)
  cleanupMin: number; // bed turnover after the service
  variant: BlockVariant;
  draggable: boolean;
  orderId?: string;
  editData?: ReservationItem; // reservation blocks carry their full record for the edit dialog
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

// Grid lines are 15-min for readability, but clicks/drags snap to 5-min so you
// can place finer; the dialog's Start/End then take any exact minute.
const SNAP_MIN = 5;
const snapMin = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
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
  pending: 'border border-dashed border-amber-500 bg-amber-400/45 text-amber-950 dark:text-amber-100',
  confirmed: 'border border-dashed border-violet-500/70 bg-violet-500/25 text-violet-950 dark:text-violet-100',
  scheduled: 'border border-primary/50 bg-primary/30 text-foreground',
  in_service: 'bg-blue-500/80 text-white',
  completed: 'bg-zinc-400/70 text-white line-through dark:bg-zinc-500/70',
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
  onEmptyClick: (bedId: string, min: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bed:${bed.id}` });
  // Pack lanes by the bed-occupied span (service + cleanup tail) so a block's
  // turnover doesn't get covered by the next booking.
  const { lanes, count } = assignLanes(blocks.map((b) => ({ startMin: b.startMin, endMin: b.endMin + b.cleanupMin })));
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
          const min = snapMin(windowStartMin + (e.clientX - rect.left) / PX_PER_MIN);
          onEmptyClick(bed.id, min);
        }}
      >
        {hours.map((h) => (
          <div key={h} className="absolute top-0 bottom-0 border-l border-border" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN }} />
        ))}
        {hours.slice(0, -1).flatMap((h) => [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((q) => {
          const quarter = q % 15 === 0;
          return (
            <div
              key={`${h}-${q}`}
              className={`absolute top-0 bottom-0 border-l ${q === 30 ? 'border-border/75' : quarter ? 'border-border/55 border-dashed' : 'border-border/25'}`}
              style={{ left: (h * 60 + q - windowStartMin) * PX_PER_MIN }}
            />
          );
        }))}
        {blocks.map((b, i) => (
          <div key={b.key} className="absolute inset-x-0" style={{ top: lanes[i] * LANE_H }}>
            {b.prepMin > 0 && (
              <div
                className="absolute rounded-l-sm border border-dashed border-zinc-500/70 bg-zinc-400/25"
                style={{ left: (b.startMin - b.prepMin - windowStartMin) * PX_PER_MIN, width: b.prepMin * PX_PER_MIN, top: 3, height: LANE_H - 6 }}
                title={`Prep ${b.prepMin}m`}
              />
            )}
            {b.cleanupMin > 0 && (
              <div
                className="absolute rounded-r-sm border border-dashed border-zinc-500/70 bg-zinc-400/25"
                style={{ left: (b.endMin - windowStartMin) * PX_PER_MIN, width: b.cleanupMin * PX_PER_MIN, top: 3, height: LANE_H - 6 }}
                title={`Cleanup ${b.cleanupMin}m`}
              />
            )}
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
  branchId, day, beds, blocks, windowStartMin, windowEndMin, bedCount, shiftWindows, nowMin, dialog,
}: {
  branchId: string;
  day: string;
  beds: BoardBed[];
  blocks: BoardBlock[];
  windowStartMin: number;
  windowEndMin: number;
  bedCount: number;
  shiftWindows: { startMin: number; endMin: number }[];
  nowMin: number | null;
  dialog: BoardDialogData;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const suppressClick = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Click an empty slot → open the prefilled New Reservation dialog directly
  // (confirmed, so it holds the clicked bed/time). Walk-ins use the same flow.
  const [addKey, setAddKey] = useState(0);
  const [add, setAdd] = useState<{ bedId: string; min: number } | null>(null);
  // Tap a reservation block → confirm / convert it (seat the guest), or Edit it.
  const [convert, setConvert] = useState<{ reservationId: string; guest: string; pending: boolean; editData?: ReservationItem } | null>(null);
  const [editRes, setEditRes] = useState<ReservationItem | null>(null);

  const total = Math.max(60, windowEndMin - windowStartMin);
  const trackWidth = Math.round((total / 60) * PX_PER_HOUR);
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  const floating = blocks.filter((b) => b.bedId === null);
  const blocksByBed = new Map<string, BoardBlock[]>();
  for (const b of blocks) if (b.bedId) blocksByBed.set(b.bedId, [...(blocksByBed.get(b.bedId) ?? []), b]);

  // Scrub the timeline: availability at the hovered minute (beds free from the
  // placed blocks incl. prep/cleanup; therapists on shift from the roster).
  const [hoverMin, setHoverMin] = useState<number | null>(null);
  const hoverBedsFree = hoverMin == null ? null
    : bedCount - new Set(blocks.filter((b) => b.bedId && hoverMin >= b.startMin - b.prepMin && hoverMin < b.endMin + b.cleanupMin).map((b) => b.bedId)).size;
  const hoverOnShift = hoverMin == null ? null
    : shiftWindows.filter((w) => hoverMin >= w.startMin && hoverMin < w.endMin).length;

  function openBlock(b: BoardBlock) {
    if (b.kind === 'order' && b.orderId) router.push(`/sales-orders/${b.orderId}`);
    else if (b.kind === 'reservation') setConvert({ reservationId: b.refId, guest: b.line1, pending: b.variant === 'pending', editData: b.editData });
  }

  function onEmptyClick(bedId: string, min: number) {
    if (Date.now() - suppressClick.current < 250) return; // a drag just ended
    setAdd({ bedId, min });
    setAddKey((k) => k + 1);
  }

  function onDragEnd(e: DragEndEvent) {
    suppressClick.current = Date.now();
    const block = e.active.data.current?.block as BoardBlock | undefined;
    const overId = e.over?.id as string | undefined;
    if (!block || !overId || !overId.startsWith('bed:')) return;
    const bedId = overId.slice(4);
    const deltaMin = Math.round(e.delta.x / PX_PER_MIN);
    const newStart = Math.min(windowEndMin - 15, Math.max(windowStartMin, snapMin(block.startMin + deltaMin)));
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
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <Card className="relative p-0 overflow-auto max-h-[calc(100vh-16rem)]">
        <div
          className="relative"
          style={{ minWidth: LABEL_W + trackWidth }}
          onMouseMove={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left - LABEL_W;
            if (x < 0) { setHoverMin(null); return; }
            setHoverMin(Math.min(windowEndMin, Math.max(windowStartMin, snapMin(windowStartMin + x / PX_PER_MIN))));
          }}
          onMouseLeave={() => setHoverMin(null)}
        >
          {/* hour + 15-min ruler */}
          <div className="flex border-b border-border sticky top-0 z-30 bg-muted">
            <div className="w-40 shrink-0 p-2 flex items-center justify-center text-center text-xs font-bold text-muted-foreground sticky left-0 z-40 bg-muted">Station</div>
            <div className="relative h-12" style={{ minWidth: trackWidth }}>
              {/* top tier: the hour, centered over its band */}
              {hours.slice(0, -1).map((h) => (
                <div key={h} className="absolute top-0 bottom-0 border-l border-border" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN, width: PX_PER_HOUR }}>
                  <span className="absolute top-1 inset-x-0 text-center text-sm font-bold tabular-nums">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
              {/* dashed divider between the hour tier and the minute tier */}
              <div className="absolute left-0 right-0 border-t border-dashed border-border/50" style={{ top: 23 }} />
              {/* minute ticks: 15-min stronger, 5-min faint */}
              {hours.slice(0, -1).flatMap((h) => [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((q) => {
                const quarter = q % 15 === 0;
                return (
                  <div
                    key={`t${h}-${q}`}
                    className={`absolute bottom-0 border-l ${quarter ? 'h-3 border-border/45' : 'h-1.5 border-border/25'}`}
                    style={{ left: (h * 60 + q - windowStartMin) * PX_PER_MIN }}
                  />
                );
              }))}
              {/* minute labels, centered on their mark, in the lower tier */}
              {hours.slice(0, -1).flatMap((h) => [15, 30, 45].map((q) => (
                <span
                  key={`l${h}-${q}`}
                  className="absolute -translate-x-1/2 text-[10px] font-bold text-muted-foreground tabular-nums"
                  style={{ left: (h * 60 + q - windowStartMin) * PX_PER_MIN, top: 27 }}
                >
                  {q}
                </span>
              )))}
              {nowMin != null && nowMin >= windowStartMin && (
                <div className="absolute top-0 bottom-0 z-10 -translate-x-1/2 flex flex-col items-center" style={{ left: (nowMin - windowStartMin) * PX_PER_MIN }}>
                  <span className="rounded bg-red-500 px-1 text-[9px] font-bold leading-tight text-white">{hhmm(nowMin)}</span>
                </div>
              )}
              {hoverMin != null && (
                <div className="absolute top-0.5 z-40 -translate-x-1/2 pointer-events-none" style={{ left: (hoverMin - windowStartMin) * PX_PER_MIN }}>
                  <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-tight text-primary-foreground whitespace-nowrap shadow">
                    {hhmm(hoverMin)} · {hoverBedsFree} bed{hoverBedsFree === 1 ? '' : 's'} · {hoverOnShift} on shift
                  </span>
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

          {/* scrub cursor — follows the pointer, marks the time the readout shows */}
          {hoverMin != null && (
            <div className="absolute top-0 bottom-0 z-20 w-px bg-primary/70 pointer-events-none" style={{ left: LABEL_W + (hoverMin - windowStartMin) * PX_PER_MIN }} />
          )}
        </div>

      </Card>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-violet-500/70 bg-violet-500/25" /> Reservation — confirmed</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-amber-500 bg-amber-400/45" /> Reservation — pending</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-primary/50 bg-primary/30" /> Order — scheduled</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-blue-500/80" /> In service</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-zinc-400/70 dark:bg-zinc-500/70" /> Completed</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-zinc-500/70 bg-zinc-400/25" /> Prep / cleanup</span>
      </div>

      {add && synthetic && (
        <NewReservationDialog
          key={addKey}
          branches={dialog.branches}
          sources={dialog.sources}
          serviceCategories={dialog.serviceCategories}
          serviceItems={dialog.serviceItems}
          reservation={synthetic}
          prefillConfirmed
          lockedBed={{ name: beds.find((b) => b.id === add.bedId)?.name ?? 'Bed' }}
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
          onEdit={convert.editData ? () => { const ed = convert.editData!; setConvert(null); setEditRes(ed); } : undefined}
        />
      )}

      {editRes && (
        <NewReservationDialog
          mode="edit"
          branches={dialog.branches}
          sources={dialog.sources}
          serviceCategories={dialog.serviceCategories}
          serviceItems={dialog.serviceItems}
          reservation={editRes}
          open
          onOpenChange={(o) => { if (!o) { setEditRes(null); router.refresh(); } }}
        />
      )}
    </DndContext>
  );
}
