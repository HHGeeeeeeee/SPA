'use client';

import { Fragment, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Users, ChevronDown, ChevronRight, BedDouble, Scissors, Hand } from 'lucide-react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NewReservationDialog, type ReservationItem } from '@/components/reservations/new-reservation-dialog';
import { moveScheduledOrderItem, assignTherapistToOrderItem } from '@/app/(dashboard)/calendar/actions';
import { startOrderItem } from '@/app/(dashboard)/sales-orders/actions';

export interface BoardBed {
  id: string;
  name: string;
  /** Station resource_type (axis='bed') or position code (axis='person').
   *  Drives the per-group headers + per-type counts in the hover popup. */
  type: string;
  /** Person rows (axis='person') carry their shift window so the row paints a
   *  faint "on shift" band; bed rows leave these undefined. */
  shiftStartMin?: number | null;
  shiftEndMin?: number | null;
  /** Bed rows (axis='bed') carry their branch code + zone so the board can nest
   *  Branch > Type > Zone > Station. */
  branch?: string;
  zone?: string | null;
}
export type BlockVariant = 'pending' | 'confirmed' | 'scheduled' | 'in_service' | 'completed';
export interface BoardBlock {
  key: string;
  kind: 'reservation' | 'order';
  refId: string;
  bedId: string | null; // null = floating (top lane); see also `external` below
  /** Reservation is dispatched to a hotel room — never gets a bed. Renders in
   *  the External lane (above To place) and can't be dragged onto a bed. */
  external?: boolean;
  guest?: string; // booking guest name — shown at the top of the block
  pax?: number;   // group size, shown next to the guest
  line1: string;
  line2?: string;
  startMin: number;
  endMin: number;
  durationMin: number;
  prepMin: number; // bed turnover before the service (drawn as a buffer)
  cleanupMin: number; // bed turnover after the service
  variant: BlockVariant;
  draggable: boolean;
  /** Floating booking with no time yet — lives in the rail's "no time" section
   *  and never appears on the axis or in the per-hour pending band. startMin is
   *  a placeholder (windowStartMin) for these. */
  untimed?: boolean;
  orderId?: string;
  /** The order still has a balance (total ≠ paid) — drawn as a red dot on the
   *  block so the desk can spot unsettled bookings at a glance. */
  owing?: boolean;
  editData?: ReservationItem; // reservation blocks carry their full record for the edit dialog
  /** Therapist on this block. Used by the hover popup to mark staff busy at
   *  a hovered minute (block's own variant decides if it actually occupies
   *  the therapist — completed / interrupted don't). */
  therapistId?: string | null;
  /** On-site booking that still has no bed (resource_id null). Drives the red
   *  "not assigned" hint and unlocks the People popover's "Assign bed" picker. */
  bedUnassigned?: boolean;
  /** Not-yet-started booking missing a therapist and/or a station — the block
   *  paints in the red "needs assignment" scheme so the desk can spot it. */
  needsAssignment?: boolean;
  /** Station types this service may use (service item's allowed types, else the
   *  category's required type). Empty = any bed. Filters the bed picker. */
  allowedResourceTypes?: string[];
}
/** A candidate bed for the People board's "Assign bed" picker: every active
 *  station in the share group, carrying its busy windows so the popover can
 *  offer only the ones free during the booking. */
export interface AssignBed {
  id: string;
  name: string;
  branch: string;
  type: string;
  zone: string | null;
  busy: { s: number; e: number }[];
}
export interface BoardStaffShift {
  id: string;
  name: string;
  code: string;
  /** Position code (MASSAGE_THERAPIST / HAIR_STYLIST / NAIL_TECHNICIAN /
   *  MASSAGE_NEWBI / receptionist / etc). Non-service positions are
   *  filtered out server-side so this should always be a service role. */
  positionCode: string | null;
  /** Home-branch code — shown as a tag on the Staff rail when multiple branches
   *  are on the board (so borrowed therapists are obvious). */
  branch?: string;
  startMin: number;
  endMin: number;
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
const LANE_H = 40; // two compact lines (guest·service / therapist)
const LABEL_W = 160;

// Grid lines are 15-min for readability, but clicks/drags snap to 5-min so you
// can place finer; the dialog's Start/End then take any exact minute.
const SNAP_MIN = 5;
const snapMin = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
// Board minutes can exceed 1440 on a past-midnight board (e.g. 1500 = 01:00 the
// next clock day); display wraps to a 24h clock and ISO rolls to the next date.
const hhmm = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const makeIso = (day: string, min: number) => {
  const dayMin = ((min % 1440) + 1440) % 1440;
  let d = day;
  if (min >= 1440) {
    const [y, m, dd] = day.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, dd + 1));
    const p = (n: number) => String(n).padStart(2, '0');
    d = `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
  }
  return `${d}T${String(Math.floor(dayMin / 60)).padStart(2, '0')}:${String(dayMin % 60).padStart(2, '0')}:00+08:00`;
};

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

interface HoverStations {
  free: number;
  total: number;
  byType: { type: string; label: string; free: number; total: number }[];
}
interface HoverStaff {
  free: number;
  total: number;
  byPosition: { code: string; label: string; free: number; onShift: number; freeNames: string[] }[];
}

// Floating "who's free at this minute" popover. Anchored to the scrub line via
// `x`, flipped left when close to the right edge so it doesn't clip. Two
// stacked sections — Stations (rooms / chairs / nail) and Staff (per position
// with up to 3 free names) — so the desk sees live "who's free" at a glance.
function HoverPopover({ x, time, stations, staff }: { x: number; time: string; stations: HoverStations; staff: HoverStaff }) {
  // Heuristic flip: if cursor is in the right third of a typical board (~800pt),
  // anchor the popover to the cursor's RIGHT side so it grows leftward.
  // (The board is overflow-auto inside a Card, so a more precise measurement
  // would need a ref + resize observer; the heuristic is good enough in practice.)
  const flipLeft = x > 560;
  return (
    <div
      className="absolute z-40 pointer-events-none"
      style={{
        left: flipLeft ? undefined : x + 12,
        right: flipLeft ? undefined : undefined,
        // transform shifts the box if anchored to the right side
        transform: flipLeft ? `translate(calc(${x}px - 100% - 12px), 24px)` : `translate(0, 24px)`,
        top: 48, // sit just below the ruler
      }}
    >
      <div className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm min-w-[200px] max-w-[260px]">
        <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1 mb-1">
          <span className="text-xs font-extrabold tabular-nums">{time}</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">availability</span>
        </div>

        {/* Stations */}
        <div className="flex flex-col gap-0.5 mb-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            <span>Stations</span>
            <span className="tabular-nums">{stations.free}/{stations.total}</span>
          </div>
          <div className="flex flex-wrap gap-x-2 text-[11px] font-semibold text-muted-foreground tabular-nums">
            {stations.byType.map((t) => (
              <span key={t.type} className={cn('inline-flex items-baseline gap-1', t.total === 0 && 'opacity-50')}>
                <span>{t.label}</span>
                <span className={cn('font-bold', t.total > 0 && t.free === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>{t.free}·{t.total}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Staff — per-position sections with up to 3 free names */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            <span>Staff</span>
            <span className="tabular-nums">{staff.free}/{staff.total} on shift</span>
          </div>
          {staff.byPosition.length === 0 ? (
            <span className="text-[11px] font-semibold italic text-muted-foreground/70">No service staff on shift</span>
          ) : (
            staff.byPosition.map((p) => {
              const overflow = p.free - p.freeNames.length;
              return (
                <div key={p.code} className="flex flex-col gap-0">
                  <div className="flex items-baseline justify-between text-[11px] font-bold">
                    <span>{p.label}</span>
                    <span className={cn('tabular-nums', p.free === 0 && p.onShift > 0 && 'text-amber-600 dark:text-amber-400')}>
                      {p.free}/{p.onShift}
                    </span>
                  </div>
                  {p.free > 0 ? (
                    <div className="text-[10px] font-medium text-muted-foreground">
                      {p.freeNames.join(', ')}
                      {overflow > 0 && <span className="text-muted-foreground/70"> +{overflow} more</span>}
                    </div>
                  ) : (
                    <div className="text-[10px] font-medium italic text-muted-foreground/70">all busy</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

const VARIANT_CLASS: Record<BlockVariant, string> = {
  pending: 'border border-dashed border-amber-500 bg-amber-400/45 text-amber-950 dark:text-amber-100',
  confirmed: 'border border-dashed border-violet-500/70 bg-violet-500/25 text-violet-950 dark:text-violet-100',
  scheduled: 'border border-primary/50 bg-primary/30 text-foreground',
  in_service: 'bg-blue-500/80 text-white',
  completed: 'bg-zinc-400/70 text-white line-through dark:bg-zinc-500/70',
};
// A not-yet-started booking still missing a therapist and/or a station paints
// red regardless of variant, so unassigned work stands out on either board.
const NEEDS_ASSIGN_CLASS = 'border border-dashed border-red-500/80 bg-red-500/25 text-red-950 dark:text-red-100';
// The block's colour: red when it needs an assignment, else its variant scheme.
const blockClass = (b: BoardBlock) => (b.needsAssignment ? NEEDS_ASSIGN_CLASS : VARIANT_CLASS[b.variant]);

function BlockView({ block, windowStartMin, onOpen, assignMode }: { block: BoardBlock; windowStartMin: number; onOpen: (b: BoardBlock, e: React.MouseEvent) => void; assignMode?: boolean }) {
  const { attributes, listeners, setNodeRef: dragRef, transform, isDragging } = useDraggable({
    id: block.key,
    data: { block },
    disabled: !block.draggable,
  });
  // Not-yet-started bookings with no therapist accept a dragged staff card.
  const canAssign = block.draggable && !block.therapistId;
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `assign:${block.refId}`, disabled: !canAssign });
  const setNodeRef = (node: HTMLElement | null) => { dragRef(node); dropRef(node); };
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
      onClick={(e) => { e.stopPropagation(); onOpen(block, e); }}
      style={style}
      className={`absolute rounded px-1.5 flex flex-col justify-center overflow-hidden text-[10px] leading-tight ${block.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${blockClass(block)} ${assignMode && canAssign ? (isOver ? 'ring-2 ring-primary ring-offset-1' : 'ring-2 ring-primary/40') : ''}`}
      title={`${block.guest ? `${block.guest}${block.pax && block.pax > 1 ? ` · ${block.pax} pax` : ''} · ` : ''}${block.line1}${block.line2 ? ` · ${block.line2}` : ''} · ${hhmm(block.startMin)}–${hhmm(block.endMin)}${block.owing ? ' · balance due' : ''}`}
    >
      {/* Balance-due flag: a red dot on any order block that isn't paid in full
          (total ≠ paid), so unsettled bookings stand out on the board. */}
      {block.owing && (
        <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-red-600 ring-1 ring-white dark:ring-black/40" title="Balance due" />
      )}
      {/* Two lines: guest · service on top, therapist below. Pax / time / status
          live in the title tooltip + the click popover. */}
      <span className="truncate font-semibold">
        {block.guest ? `${block.guest} · ` : ''}{block.line1}
      </span>
      {block.bedUnassigned
        ? <span className="truncate font-medium">
            {/* "<branch> · not assigned" — branch faint, the bedless part red so
                an unbeded booking stands out on the People board. */}
            <span className="opacity-80">{block.line2?.replace(/·.*$/, '· ')}</span>
            <span className="font-extrabold text-red-600 dark:text-red-400">not assigned</span>
          </span>
        : block.line2
          ? <span className="truncate font-medium opacity-80">{block.line2}</span>
          : !block.therapistId
            ? <span className="truncate font-extrabold text-red-600 dark:text-red-400">Not assigned</span>
            : null}
    </div>
  );
}

function BedRow({
  bed, blocks, windowStartMin, trackWidth, hours, nowMin, onOpen, onEmptyClick, assignMode,
}: {
  bed: BoardBed;
  blocks: BoardBlock[];
  windowStartMin: number;
  trackWidth: number;
  hours: number[];
  nowMin: number | null;
  onOpen: (b: BoardBlock, e: React.MouseEvent) => void;
  onEmptyClick: (bedId: string, min: number) => void;
  assignMode?: boolean;
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
        {/* On-shift band (person rows only) — a faint tint over the hours this
            therapist is rostered; bookings render on top. */}
        {bed.shiftStartMin != null && bed.shiftEndMin != null && bed.shiftEndMin > bed.shiftStartMin && (
          <div
            className="absolute top-1 bottom-1 rounded bg-primary/10"
            style={{ left: (bed.shiftStartMin - windowStartMin) * PX_PER_MIN, width: (bed.shiftEndMin - bed.shiftStartMin) * PX_PER_MIN }}
            title="On shift"
          />
        )}
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
            <BlockView block={b} windowStartMin={windowStartMin} onOpen={onOpen} assignMode={assignMode} />
          </div>
        ))}
        {nowMin != null && nowMin >= windowStartMin && (
          <div className="absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: (nowMin - windowStartMin) * PX_PER_MIN }} />
        )}
      </div>
    </div>
  );
}

// A draggable card in the left "Unallocated" rail. It carries no axis position;
// dragging it onto a bed row places it (a timed card keeps its booked time, an
// untimed card lands at the drop point).
function RailCard({ block, onOpen }: { block: BoardBlock; onOpen: (b: BoardBlock, e: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.key,
    data: { block },
    disabled: !block.draggable,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
    touchAction: 'none',
  };
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onOpen(block, e); }}
      style={style}
      className={`rounded px-2 py-1.5 flex flex-col gap-0.5 overflow-hidden text-[11px] leading-tight ${block.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${blockClass(block)}`}
      title={`${block.guest ? `${block.guest} · ` : ''}${block.line1}${block.line2 ? ` · ${block.line2}` : ''}${block.untimed ? '' : ` · ${hhmm(block.startMin)}`}`}
    >
      {block.guest && (
        <span className="truncate font-bold">
          {block.pax && block.pax > 1 ? <Users className="mr-0.5 -mt-0.5 inline size-3" /> : null}
          {block.guest}
          {block.pax && block.pax > 1 ? <span className="ml-1 font-extrabold">· {block.pax}p</span> : null}
        </span>
      )}
      <span className={`truncate ${block.guest ? 'font-semibold opacity-90' : 'font-bold'}`}>{block.line1}</span>
      {block.line2 && <span className="truncate font-medium opacity-80">{block.line2}</span>}
      {!block.untimed && <span className="truncate font-semibold tabular-nums opacity-70">{hhmm(block.startMin)}</span>}
    </div>
  );
}

// A draggable on-shift therapist (Station rail, Staff mode). Drag onto an
// unassigned service block to set its therapist; the badge is today's booking load.
function StaffCard({ id, name, load, branch, shift }: { id: string; name: string; load: number; branch?: string; shift?: string }) {
  // No transform here — a DragOverlay renders the moving copy so it isn't clipped
  // by the rail's overflow. The source just dims while dragging.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `staff:${id}`,
    data: { staff: { id, name } },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: 'none', opacity: isDragging ? 0.4 : 1 }}
      className="flex flex-col gap-0.5 rounded border border-border bg-card px-2 py-1.5 text-[11px] cursor-grab active:cursor-grabbing hover:bg-accent"
      title={`${name}${branch ? ` · ${branch}` : ''}${shift ? ` · ${shift}` : ''} · ${load} booking${load === 1 ? '' : 's'} today`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate font-bold">{name}</span>
        {branch && <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{branch}</span>}
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-extrabold tabular-nums text-muted-foreground">{load}</span>
      </div>
      {shift && <span className="tabular-nums text-[9px] font-semibold text-muted-foreground">{shift}</span>}
    </div>
  );
}

// Full-width collapsible group header (Branch / Type / Zone) for the bed board's
// nesting. The label column is sticky-left so it stays put while the timeline
// scrolls; the rest of the row is empty to keep the time axis aligned.
function GroupHeader({ label, count, collapsed, onToggle, trackWidth, Icon, indent = 0, tone }: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  trackWidth: number;
  Icon?: React.ComponentType<{ className?: string }>;
  indent?: number;
  tone: string;
}) {
  return (
    <div className={`flex border-b border-border ${tone}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-40 shrink-0 p-2 flex items-center gap-1.5 sticky left-0 z-20 ${tone} text-left hover:brightness-95 transition-[filter]`}
        style={{ paddingLeft: 8 + indent * 14 }}
      >
        {collapsed ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
        {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground truncate">{label}</span>
        <span className="ml-auto pr-1 font-extrabold tabular text-xs text-foreground/80">{count}</span>
      </button>
      <div className="flex-1" style={{ minWidth: trackWidth }} />
    </div>
  );
}

export function ScheduleBoard({
  branchId, day, beds, blocks, windowStartMin, windowEndMin, bedCount, staffShifts, nowMin, dialog,
  axis = 'bed', subjectLabel = 'Station', assignBeds = [],
}: {
  branchId: string;
  day: string;
  beds: BoardBed[];
  blocks: BoardBlock[];
  windowStartMin: number;
  windowEndMin: number;
  bedCount: number;
  staffShifts: BoardStaffShift[];
  nowMin: number | null;
  dialog: BoardDialogData;
  /** 'bed' (default) = rows are stations, drop assigns a bed. 'person' = rows
   *  are therapists, drop pre-assigns the therapist. The page keys each block's
   *  bedId to the row id (resource_id for bed, therapist_id for person). */
  axis?: 'bed' | 'person';
  subjectLabel?: string;
  /** Candidate beds for the People popover's "Assign bed" picker (axis='person'
   *  only). Every active station in the share group with its busy windows. */
  assignBeds?: AssignBed[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const suppressClick = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The grid's full-width content div — used to turn a drop's pointer-X into a
  // time when an untimed rail card is dropped onto a bed.
  const contentRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Click an empty slot → open the prefilled New Reservation dialog directly
  // (confirmed, so it holds the clicked bed/time). Walk-ins use the same flow.
  const [addKey, setAddKey] = useState(0);
  const [add, setAdd] = useState<{ bedId: string; min: number } | null>(null);
  // Block-detail popover (opened by clicking a booking; "Open order" navigates).
  const [detail, setDetail] = useState<{ block: BoardBlock; x: number; y: number } | null>(null);
  // Station rail: 'bookings' (unallocated) vs 'staff' (on-shift therapists to
  // drag onto unassigned services). staffDragId is set while a staff card drags,
  // to light up the droppable (unassigned) blocks.
  const [railMode, setRailMode] = useState<'bookings' | 'staff'>('bookings');
  const [staffDragId, setStaffDragId] = useState<string | null>(null);
  const [activeStaffName, setActiveStaffName] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');

  const total = Math.max(60, windowEndMin - windowStartMin);
  const trackWidth = Math.round((total / 60) * PX_PER_HOUR);
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  const floating = blocks.filter((b) => b.bedId === null);
  // Rail sections: "no time yet" (untimed) vs "needs a bed" (timed but bedless),
  // the latter sorted by their booked time.
  const untimedFloating = floating.filter((b) => b.untimed);
  const timedFloating = floating.filter((b) => !b.untimed).sort((a, b) => a.startMin - b.startMin);
  // Per-hour pending demand (甲): timed-but-bedless bookings bucketed by start
  // hour. Drops to zero for an hour as those bookings get a bed.
  const pendingByHour = new Map<number, number>();
  for (const b of timedFloating) {
    const h = Math.floor(b.startMin / 60);
    pendingByHour.set(h, (pendingByHour.get(h) ?? 0) + 1);
  }
  const blocksByBed = new Map<string, BoardBlock[]>();
  for (const b of blocks) if (b.bedId) blocksByBed.set(b.bedId, [...(blocksByBed.get(b.bedId) ?? []), b]);

  // Scrub the timeline: availability at the hovered minute (stations free from
  // the placed blocks incl. prep/cleanup; staff on shift from the roster).
  const [hoverMin, setHoverMin] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // The availability popover only floats while the pointer is over the top strip
  // (time ruler + Pending/hr band), not over the bed rows.
  const [hoverStrip, setHoverStrip] = useState(false);

  // Stable station ordering / labelling for the hover popup's Stations section.
  const STATION_ORDER = ['massage_bed', 'hair_chair', 'nail_station'] as const;
  const STATION_LABEL: Record<string, string> = { massage_bed: 'bed', hair_chair: 'hair', nail_station: 'nail' };
  // Plural labels + icons for the in-grid type-group headers. Anything outside
  // STATION_ORDER falls through to the default label / icon.
  const STATION_GROUP_LABEL: Record<string, string> = {
    massage_bed: 'Beds', hair_chair: 'Hair chairs', nail_station: 'Nail stations',
  };
  const STATION_GROUP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    massage_bed: BedDouble, hair_chair: Scissors, nail_station: Hand,
  };

  // Collapse state per type-group, persisted per branch so the desk's
  // preference survives navigation. Default = every group expanded.
  const STORAGE_KEY = `hhg-spa:schedule-board:collapsed:${branchId}`;
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsedTypes(new Set(JSON.parse(raw)));
    } catch { /* defensive */ }
  }, [STORAGE_KEY]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedTypes])); } catch { /* defensive */ }
  }, [collapsedTypes, STORAGE_KEY]);
  // "Available only" filter: hide rows that can't take a booking in the viewed
  // window — off-shift (person) / inactive, OR fully occupied (no free gap).
  // Persisted per branch + axis so each board remembers its own state.
  const AVAIL_KEY = `hhg-spa:schedule-board:availableOnly:${branchId}:${axis}`;
  const [availableOnly, setAvailableOnly] = useState(false);
  // The minute the "available" check is evaluated at — a whole-day gap test is
  // useless (nearly everything has some gap), so availability is "free at this
  // time". Defaults to the next 15-min mark (clamped to the window).
  const nextQ = (m: number) => { const r = m % 15; return r === 0 ? m : m + (15 - r); };
  const [availAt, setAvailAt] = useState(() =>
    Math.max(windowStartMin, Math.min(windowEndMin, nextQ(nowMin ?? windowStartMin))),
  );
  useEffect(() => {
    // Load after mount (not in a lazy initializer) so SSR markup stays stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setAvailableOnly(window.localStorage.getItem(AVAIL_KEY) === '1'); } catch { /* defensive */ }
  }, [AVAIL_KEY]);
  useEffect(() => {
    try { window.localStorage.setItem(AVAIL_KEY, availableOnly ? '1' : '0'); } catch { /* defensive */ }
  }, [availableOnly, AVAIL_KEY]);
  // On open, jump the horizontal scroll to ~2h before "now" so the desk lands on
  // the live part of the 24h board instead of at 00:00. Only when viewing today
  // (nowMin set); other days stay at the start.
  useEffect(() => {
    if (nowMin == null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, (nowMin - 120 - windowStartMin) * PX_PER_MIN);
  }, [nowMin, windowStartMin]);
  const toggleType = (t: string) =>
    setCollapsedTypes((p) => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const POSITION_ORDER = ['MASSAGE_THERAPIST', 'MASSAGE_NEWBI', 'HAIR_STYLIST', 'NAIL_TECHNICIAN'];
  const POSITION_LABEL: Record<string, string> = {
    MASSAGE_THERAPIST: 'Massage', MASSAGE_NEWBI: 'Newbi', HAIR_STYLIST: 'Hair', NAIL_TECHNICIAN: 'Nail',
  };
  // Staff-mode rail (bed axis): today's booking load per therapist + the on-shift
  // therapists grouped by position, ordered by shift start then name.
  const loadByTherapist = (() => {
    const m = new Map<string, number>();
    for (const b of blocks) if (b.therapistId) m.set(b.therapistId, (m.get(b.therapistId) ?? 0) + 1);
    return m;
  })();
  const staffGroups = (() => {
    const byPos = new Map<string, BoardStaffShift[]>();
    for (const s of staffShifts) { const k = s.positionCode ?? '_other'; if (!byPos.has(k)) byPos.set(k, []); byPos.get(k)!.push(s); }
    const order = [...POSITION_ORDER.filter((p) => byPos.has(p)), ...[...byPos.keys()].filter((p) => !POSITION_ORDER.includes(p))];
    return order.map((pos) => ({
      pos,
      label: POSITION_LABEL[pos] ?? pos.replace(/_/g, ' '),
      staff: byPos.get(pos)!.slice().sort((a, b) => a.startMin - b.startMin || a.name.localeCompare(b.name)),
    }));
  })();
  // Tag home branch only when the board spans >1 branch (borrowed staff stand out).
  const staffMultiBranch = new Set(staffShifts.map((s) => s.branch).filter(Boolean)).size > 1;
  const staffQuery = staffSearch.trim().toLowerCase();
  const filteredStaffGroups = staffQuery
    ? staffGroups.map((g) => ({ ...g, staff: g.staff.filter((s) => s.name.toLowerCase().includes(staffQuery)) })).filter((g) => g.staff.length)
    : staffGroups;
  // Group headers: stations by resource_type (bed axis) or therapists by
  // position (person axis), in a stable display order; unknown groups append.
  const groupOrder = axis === 'person' ? POSITION_ORDER : [...STATION_ORDER];
  const groupLabel = (t: string) =>
    axis === 'person' ? (POSITION_LABEL[t] ?? t.replace(/_/g, ' ')) : (STATION_GROUP_LABEL[t] ?? t.replace(/_/g, ' '));
  const groupIcon = (t: string): React.ComponentType<{ className?: string }> =>
    axis === 'person' ? Users : (STATION_GROUP_ICON[t] ?? BedDouble);

  // A row is "available" if it can take a booking AT `availAt`. Mirrors the
  // hover popover's "who's free at this minute": a station is busy if a block
  // overlaps [start − prep, end + cleanup]; a person must be on shift at that
  // minute and not running a scheduled/in-service/confirmed block then.
  function isFreeAt(bed: BoardBed): boolean {
    const t = availAt;
    const rowBlocks = blocksByBed.get(bed.id) ?? [];
    if (axis === 'person') {
      if (bed.shiftStartMin == null || bed.shiftEndMin == null) return false;
      return t >= bed.shiftStartMin && t < bed.shiftEndMin; // on shift at t
    }
    const busy = rowBlocks.some((b) => !b.untimed && t >= b.startMin - b.prepMin && t < b.endMin + b.cleanupMin);
    return !busy;
  }
  const visibleBeds = availableOnly ? beds.filter(isFreeAt) : beds;

  // Bed board nesting: Branch > Type > Zone > Station. STATION_ORDER orders the
  // types; branches + zones sort alphabetically. (The person board keeps the flat
  // position grouping above.)
  const groupTree = (() => {
    const byBranch = new Map<string, BoardBed[]>();
    for (const b of visibleBeds) { const k = b.branch ?? '—'; if (!byBranch.has(k)) byBranch.set(k, []); byBranch.get(k)!.push(b); }
    return [...byBranch.keys()].sort().map((branch) => {
      const rows = byBranch.get(branch)!;
      const byType = new Map<string, BoardBed[]>();
      for (const b of rows) { if (!byType.has(b.type)) byType.set(b.type, []); byType.get(b.type)!.push(b); }
      const typeKeys = [...groupOrder.filter((t) => byType.has(t)), ...[...byType.keys()].filter((t) => !(groupOrder as readonly string[]).includes(t))];
      return {
        branch, count: rows.length,
        types: typeKeys.map((type) => {
          const trows = byType.get(type)!;
          // Bed axis nests a Zone level; person axis has no zones (people are the leaves).
          let zones: { zone: string; count: number; rows: BoardBed[] }[];
          if (axis === 'bed') {
            const byZone = new Map<string, BoardBed[]>();
            for (const b of trows) { const z = b.zone ?? ''; if (!byZone.has(z)) byZone.set(z, []); byZone.get(z)!.push(b); }
            zones = [...byZone.keys()].sort().map((zone) => ({ zone, count: byZone.get(zone)!.length, rows: byZone.get(zone)! }));
          } else {
            zones = [{ zone: '', count: trows.length, rows: trows }];
          }
          return { type, label: groupLabel(type), Icon: groupIcon(type), count: trows.length, zones };
        }),
      };
    });
  })();

  // Per-type station free-now @ hoverMin. A station is "busy" if any block on
  // it overlaps [start − prep, end + cleanup]; everything else is free.
  const hoverStations = hoverMin == null ? null : (() => {
    const busy = new Set(
      blocks.filter((b) => b.bedId && hoverMin >= b.startMin - b.prepMin && hoverMin < b.endMin + b.cleanupMin).map((b) => b.bedId!),
    );
    const byType = STATION_ORDER.map((type) => {
      const rows = beds.filter((b) => b.type === type);
      return { type, label: STATION_LABEL[type] ?? type, total: rows.length, free: rows.filter((b) => !busy.has(b.id)).length };
    });
    return { byType, total: beds.length, free: beds.length - busy.size };
  })();

  // Per-position staff free-now @ hoverMin. On-shift = shift window covers
  // hoverMin. Busy = a non-completed block they own overlaps [start, end].
  // (completed / interrupted lines don't tie up the therapist anymore.)
  const hoverStaff = hoverMin == null ? null : (() => {
    const occupiedAt = (b: BoardBlock) =>
      b.therapistId &&
      (b.variant === 'scheduled' || b.variant === 'in_service' || b.variant === 'confirmed') &&
      hoverMin >= b.startMin && hoverMin < b.endMin;
    const busyTh = new Set(blocks.filter(occupiedAt).map((b) => b.therapistId!));
    const onShiftIds = staffShifts.filter((s) => hoverMin >= s.startMin && hoverMin < s.endMin);
    const seenPos = new Set<string>();
    const byPosition: { code: string; label: string; free: number; onShift: number; freeNames: string[] }[] = [];
    const pickPosition = (code: string) => {
      const inPos = onShiftIds.filter((s) => s.positionCode === code);
      if (inPos.length === 0) return;
      const free = inPos.filter((s) => !busyTh.has(s.id));
      byPosition.push({
        code,
        label: POSITION_LABEL[code] ?? code.toLowerCase(),
        onShift: inPos.length,
        free: free.length,
        // Limit to 3 names to keep the popup compact; an "+X more" hint
        // surfaces overflow without growing the popup unbounded.
        freeNames: free.slice(0, 3).map((s) => s.name),
      });
      seenPos.add(code);
    };
    for (const code of POSITION_ORDER) pickPosition(code);
    // Any unknown service position not in the well-known list — render after.
    for (const s of onShiftIds) if (s.positionCode && !seenPos.has(s.positionCode)) pickPosition(s.positionCode);
    return { byPosition, total: onShiftIds.length, free: onShiftIds.length - onShiftIds.filter((s) => busyTh.has(s.id)).length };
  })();

  // Keep bedCount around (used by other callers / tests) but compute the same
  // bottom-line free count from blocks so the legacy "1 of N beds" pill still
  // works when the new popup is hidden.
  void bedCount;

  // Click a block → a small detail popover (Cloudbeds-style). It carries an
  // "Open order" button; we no longer jump straight to the order on click.
  function openBlock(b: BoardBlock, e: React.MouseEvent) {
    const PW = 256, PH = 230;
    const x = Math.max(8, Math.min(e.clientX + 8, window.innerWidth - PW - 8));
    const y = Math.max(8, Math.min(e.clientY + 8, window.innerHeight - PH - 8));
    setDetail({ block: b, x, y });
  }

  function onEmptyClick(bedId: string, min: number) {
    // bedId is the row id: a bed (axis='bed') or a therapist (axis='person').
    // The New Reservation dialog prefills the bed or pre-assigns the therapist
    // accordingly via `synthetic` below.
    if (Date.now() - suppressClick.current < 250) return; // a drag just ended
    setAdd({ bedId, min });
    setAddKey((k) => k + 1);
  }

  function doAssign(refId: string, therapistId: string, startMin: number, name?: string) {
    startTransition(async () => {
      const r = await assignTherapistToOrderItem({ item_id: refId, therapist_id: therapistId, start_min: startMin, day });
      if (r.ok) { toast.success(name ? `Assigned ${name}` : 'Therapist assigned'); router.refresh(); }
      else toast.error(r.error);
    });
  }
  // Pin a bed to a bedless booking from the People popover. Reuses
  // moveScheduledOrderItem (the Station drag's action): it sets resource_id and
  // re-stamps the booked time, leaving therapist_id untouched, and runs the same
  // bed-conflict + resource-type guards server-side.
  function doAssignBed(refId: string, bedId: string, startMin: number, name?: string) {
    startTransition(async () => {
      const r = await moveScheduledOrderItem({ item_id: refId, bed_id: bedId, start_min: startMin, day });
      if (r.ok) { toast.success(name ? `Assigned ${name}` : 'Bed assigned'); setDetail(null); router.refresh(); }
      else toast.error(r.error);
    });
  }
  // Start a scheduled service straight from the board's detail popover. Reuses
  // startOrderItem so all the therapist/bed/shift checks (and their error
  // messages) are identical to starting from the order page.
  function doStartFromBoard(itemId: string, orderId: string) {
    startTransition(async () => {
      const r = await startOrderItem(itemId, orderId);
      if (r.ok) { toast.success('Service started'); setDetail(null); router.refresh(); }
      else toast.error(r.error);
    });
  }
  // Staff drags only target `assign:` blocks; booking/bed drags only `bed:` rows.
  const collisionDetection: CollisionDetection = (args) => {
    const isStaff = !!args.active.data.current?.staff;
    const droppableContainers = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      return isStaff ? id.startsWith('assign:') : id.startsWith('bed:');
    });
    return rectIntersection({ ...args, droppableContainers });
  };
  function onDragStart(e: DragStartEvent) {
    const staff = e.active.data.current?.staff as { id: string; name: string } | undefined;
    if (staff) { setStaffDragId(staff.id); setActiveStaffName(staff.name); }
  }
  function clearStaffDrag() { setStaffDragId(null); setActiveStaffName(null); }
  function onDragEnd(e: DragEndEvent) {
    suppressClick.current = Date.now();
    clearStaffDrag();
    const overId = e.over?.id as string | undefined;
    // Staff card dropped on an unassigned service block → set its therapist.
    const staff = e.active.data.current?.staff as { id: string; name: string } | undefined;
    if (staff) {
      if (!overId || !overId.startsWith('assign:')) return;
      const refId = overId.slice('assign:'.length);
      const target = blocks.find((b) => b.refId === refId);
      if (target) doAssign(refId, staff.id, target.startMin, staff.name);
      return;
    }
    const block = e.active.data.current?.block as BoardBlock | undefined;
    if (!block || !overId || !overId.startsWith('bed:')) return;
    const bedId = overId.slice(4);
    // Where it lands on the time axis:
    //  - untimed rail card → the drop point (absolute pointer X over the grid)
    //  - timed rail card → its booked time, locked (you only pick the bed)
    //  - a block already on a bed → its time shifted by the horizontal drag delta
    let newStart: number;
    if (block.bedId === null && block.untimed) {
      const finalX = (e.activatorEvent as PointerEvent).clientX + e.delta.x;
      const contentLeft = contentRef.current?.getBoundingClientRect().left ?? 0;
      newStart = snapMin(windowStartMin + (finalX - contentLeft - LABEL_W) / PX_PER_MIN);
    } else if (block.bedId === null) {
      newStart = block.startMin;
    } else {
      newStart = snapMin(block.startMin + Math.round(e.delta.x / PX_PER_MIN));
    }
    newStart = Math.min(windowEndMin - 15, Math.max(windowStartMin, newStart));
    if (bedId === block.bedId && newStart === block.startMin) return; // no-op
    startTransition(async () => {
      const r = axis === 'person'
        ? await assignTherapistToOrderItem({ item_id: block.refId, therapist_id: bedId, start_min: newStart, day })
        : await moveScheduledOrderItem({ item_id: block.refId, bed_id: bedId, start_min: newStart, day });
      if (r.ok) { toast.success(axis === 'person' ? 'Therapist assigned' : 'Schedule updated'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  const addStartIso = add ? makeIso(day, add.min) : '';
  const addRow = add ? beds.find((b) => b.id === add.bedId) : undefined;
  const synthetic: ReservationItem | undefined = add
    ? {
        id: 'prefill', branch_id: branchId, source_id: null, service_category_ids: [],
        guest_name: '', guest_phone: null, pax: 1, gender_preference: null,
        service_location_type: 'on_site', note: null,
        desired_service_start: addStartIso,
        desired_service_end: new Date(Date.parse(addStartIso) + 60 * 60000).toISOString(),
        // Bed axis pins the clicked bed; person axis pre-assigns the clicked
        // therapist and leaves the bed to be picked later.
        resource_ids: axis === 'person' ? [] : [add.bedId],
        seat_together: false, service_item_id: null,
        therapist_id: axis === 'person' ? add.bedId : null,
        therapist_name: axis === 'person' ? (addRow?.name ?? null) : null,
      }
    : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={clearStaffDrag}>
      <div className="flex items-start gap-3">
      {/* LEFT RAIL — everything with no bed yet; drag a card onto a bed row. */}
      <Card className="w-56 shrink-0 overflow-y-auto p-0 max-h-[calc(100vh-16rem)]">
        <div className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-2">
          {axis === 'bed' ? (
            <div className="mb-1 flex rounded-md border border-border p-0.5 text-[11px] font-bold">
              {(['bookings', 'staff'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRailMode(m)}
                  className={`flex-1 rounded px-2 py-1 capitalize transition-colors ${railMode === m ? 'bg-sidebar-primary/15 text-sidebar-primary' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Unallocated</div>
          )}
          <div className="text-[11px] font-semibold text-muted-foreground">
            {axis === 'bed' && railMode === 'staff'
              ? `${staffShifts.length} on shift · drag onto an unassigned service`
              : `${floating.length} to assign · drag onto a ${axis === 'person' ? 'person' : 'bed'}`}
          </div>
          {axis === 'bed' && railMode === 'staff' && (
            <input
              type="search"
              value={staffSearch}
              onChange={(e) => setStaffSearch(e.target.value)}
              placeholder="Search therapist…"
              className="mt-1.5 w-full rounded border border-input bg-transparent px-2 py-1 text-[11px]"
            />
          )}
        </div>
        <div className="flex flex-col gap-3 p-2">
          {axis === 'bed' && railMode === 'staff' ? (
            staffShifts.length === 0 ? (
              <p className="py-6 text-center text-[11px] font-semibold italic text-muted-foreground/70">No staff on shift</p>
            ) : filteredStaffGroups.length === 0 ? (
              <p className="py-6 text-center text-[11px] font-semibold italic text-muted-foreground/70">No therapist matches “{staffSearch.trim()}”</p>
            ) : (
              filteredStaffGroups.map((g) => (
                <div key={g.pos} className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{g.label} · {g.staff.length}</div>
                  {g.staff.map((s) => <StaffCard key={s.id} id={s.id} name={s.name} load={loadByTherapist.get(s.id) ?? 0} branch={staffMultiBranch ? s.branch : undefined} shift={`${hhmm(s.startMin)}–${hhmm(s.endMin)}`} />)}
                </div>
              ))
            )
          ) : floating.length === 0 ? (
            <p className="py-6 text-center text-[11px] font-semibold italic text-muted-foreground/70">Nothing to assign</p>
          ) : (
            <>
              {untimedFloating.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">No time yet · {untimedFloating.length}</div>
                  {untimedFloating.map((b) => <RailCard key={b.key} block={b} onOpen={openBlock} />)}
                </div>
              )}
              {timedFloating.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Needs a {axis === 'person' ? 'therapist' : 'bed'} · {timedFloating.length}</div>
                  {timedFloating.map((b) => <RailCard key={b.key} block={b} onOpen={openBlock} />)}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Card ref={scrollRef} className="relative flex-1 p-0 overflow-auto max-h-[calc(100vh-16rem)]">
        <div
          ref={contentRef}
          className="relative"
          style={{ minWidth: LABEL_W + trackWidth }}
          onMouseMove={(e) => {
            // Over the top strip? The ruler (h-12) + Pending/hr band ≈ 76px, and
            // the ruler is sticky so the strip is always at the card's top edge.
            const card = scrollRef.current?.getBoundingClientRect();
            setHoverStrip(card ? e.clientY - card.top <= 76 : false);
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left - LABEL_W;
            if (x < 0) { setHoverMin(null); setHoverX(null); return; }
            setHoverMin(Math.min(windowEndMin, Math.max(windowStartMin, snapMin(windowStartMin + x / PX_PER_MIN))));
            setHoverX(LABEL_W + x);
          }}
          onMouseLeave={() => { setHoverMin(null); setHoverX(null); setHoverStrip(false); }}
        >
          {/* hour + 15-min ruler */}
          <div className="flex border-b border-border sticky top-0 z-30 bg-muted">
            <div className="w-40 shrink-0 p-2 flex flex-col items-center justify-center gap-1 text-center sticky left-0 z-40 bg-muted">
              <span className="text-xs font-bold text-muted-foreground">{subjectLabel}</span>
              <button
                type="button"
                onClick={() => setAvailableOnly((v) => {
                  if (!v) setAvailAt(Math.max(windowStartMin, Math.min(windowEndMin, nextQ(nowMin ?? windowStartMin))));
                  return !v;
                })}
                aria-pressed={availableOnly}
                title={`Show only ${subjectLabel.toLowerCase()}s that are free at the chosen time`}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold leading-tight transition-colors ${availableOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent'}`}
              >
                Available only
              </button>
              {availableOnly && (
                <input
                  type="time"
                  value={hhmm(Math.max(windowStartMin, Math.min(windowEndMin, availAt)))}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    if (!Number.isNaN(h) && !Number.isNaN(m)) setAvailAt(h * 60 + m);
                  }}
                  title="Free at this time"
                  className="w-full rounded border border-input bg-background px-1 py-0.5 text-[10px] font-bold tabular"
                />
              )}
            </div>
            <div className="relative h-12" style={{ minWidth: trackWidth }}>
              {/* top tier: the hour, centered over its band */}
              {hours.slice(0, -1).map((h) => (
                <div key={h} className="absolute top-0 bottom-0 border-l border-border" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN, width: PX_PER_HOUR }}>
                  <span className="absolute top-1 inset-x-0 text-center text-sm font-bold tabular-nums">{String(h % 24).padStart(2, '0')}:00</span>
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
                // Time pip on the ruler — narrow, always visible above the scrub
                // line. The richer popover (per-position breakdown) renders
                // outside this sticky header so it can extend down over the body.
                <div className="absolute top-0.5 z-40 -translate-x-1/2 pointer-events-none" style={{ left: (hoverMin - windowStartMin) * PX_PER_MIN }}>
                  <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-tight text-primary-foreground whitespace-nowrap shadow tabular-nums">
                    {hhmm(hoverMin)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Per-hour pending demand (甲): how many timed bookings still need a
              bed in each hour. Aligned to the time axis; clears as they're placed. */}
          <div className="flex border-b border-border bg-amber-500/5">
            <div className="w-40 shrink-0 px-2 py-1 flex items-center sticky left-0 z-20 bg-card text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Pending / hr
            </div>
            <div className="relative" style={{ height: 26, minWidth: trackWidth }}>
              {hours.slice(0, -1).map((h) => {
                const n = pendingByHour.get(h) ?? 0;
                return (
                  <div key={h} className="absolute top-0 bottom-0 flex items-center justify-center" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN, width: PX_PER_HOUR }}>
                    {n > 0 && (
                      <span className="flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold tabular-nums text-white">{n}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {visibleBeds.length === 0 ? (
            <div className="p-8 text-center text-sm font-semibold text-muted-foreground">
              {availableOnly && beds.length > 0
                ? `No ${axis === 'person' ? 'staff' : 'stations'} free at ${hhmm(availAt)} — change the time or turn off “Available only”.`
                : axis === 'person' ? 'No staff on shift this day.' : 'No active stations for this branch.'}
            </div>
          ) : (
            groupTree.map((bg) => {
              const bKey = `b:${bg.branch}`;
              const bCol = collapsedTypes.has(bKey);
              return (
                <Fragment key={bKey}>
                  <GroupHeader label={bg.branch} count={bg.count} collapsed={bCol} onToggle={() => toggleType(bKey)} trackWidth={trackWidth} indent={0} tone="bg-muted/70" />
                  {!bCol && bg.types.map((tg) => {
                    const tKey = `t:${bg.branch}:${tg.type}`;
                    const tCol = collapsedTypes.has(tKey);
                    return (
                      <Fragment key={tKey}>
                        <GroupHeader label={tg.label} count={tg.count} collapsed={tCol} onToggle={() => toggleType(tKey)} trackWidth={trackWidth} Icon={tg.Icon} indent={1} tone="bg-muted/40" />
                        {!tCol && tg.zones.map((zg) => {
                          const zKey = `z:${bg.branch}:${tg.type}:${zg.zone}`;
                          const zCol = collapsedTypes.has(zKey);
                          return (
                            <Fragment key={zKey}>
                              {zg.zone && <GroupHeader label={zg.zone} count={zg.count} collapsed={zCol} onToggle={() => toggleType(zKey)} trackWidth={trackWidth} indent={2} tone="bg-muted/20" />}
                              {(!zg.zone || !zCol) && zg.rows.map((bed) => (
                                <BedRow key={bed.id} bed={bed} blocks={blocksByBed.get(bed.id) ?? []} windowStartMin={windowStartMin} trackWidth={trackWidth} hours={hours} nowMin={nowMin} onOpen={openBlock} onEmptyClick={onEmptyClick} assignMode={staffDragId != null} />
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })
          )}

          {/* scrub cursor — follows the pointer, marks the time the readout shows */}
          {hoverMin != null && (
            <div className="absolute top-0 bottom-0 z-20 w-px bg-primary/70 pointer-events-none" style={{ left: LABEL_W + (hoverMin - windowStartMin) * PX_PER_MIN }} />
          )}

          {/* Per-position / per-station hover popover. Pinned to the scrub line
              but flipped to the left when there isn't enough room on the right
              (would otherwise clip on narrow boards). Pointer-events:none so it
              never steals a click meant for an empty bed slot. */}
          {axis === 'bed' && hoverStrip && hoverMin != null && hoverX != null && hoverStaff && hoverStations && (
            <HoverPopover x={hoverX} time={hhmm(hoverMin)} stations={hoverStations} staff={hoverStaff} />
          )}
        </div>

      </Card>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-muted-foreground">
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
          // Pass the bed's resource_type so the dialog auto-checks the
          // matching Service Type (Bed #1 → Massage, Hair Chair A → Hair, etc.).
          lockedBed={axis === 'person' ? undefined : (() => { const b = beds.find((x) => x.id === add.bedId); return { name: b?.name ?? 'Bed', type: b?.type }; })()}
          open
          onOpenChange={(o) => { if (!o) { setAdd(null); router.refresh(); } }}
        />
      )}

      {/* Click-a-block detail popover — anchored at the click point; a full-screen
          backdrop closes it. Summary first; "Open order" to actually go in. */}
      {detail && (() => {
        const b = detail.block;
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDetail(null)} />
            <div
              className="fixed z-50 w-64 rounded-lg border border-border bg-card p-3 shadow-xl"
              style={{ left: detail.x, top: detail.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 border-b border-border pb-1.5 mb-2">
                <span className="font-bold text-sm truncate">{b.guest || b.line1}</span>
                <button type="button" onClick={() => setDetail(null)} className="shrink-0 text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-[13px]">
                {b.guest && (
                  <>
                    <dt className="font-medium text-muted-foreground">Guest</dt>
                    <dd className="font-semibold truncate">{b.guest}{b.pax && b.pax > 1 ? ` · ${b.pax} pax` : ''}</dd>
                  </>
                )}
                <dt className="font-medium text-muted-foreground">Service</dt>
                <dd className="font-semibold truncate">{b.line1}</dd>
                {b.line2 && (
                  <>
                    <dt className="font-medium text-muted-foreground">{axis === 'person' ? 'Detail' : 'Therapist'}</dt>
                    <dd className="font-semibold truncate">{b.line2}</dd>
                  </>
                )}
                <dt className="font-medium text-muted-foreground">Time</dt>
                <dd className="font-semibold tabular-nums">{b.untimed ? 'No time yet' : `${hhmm(b.startMin)}–${hhmm(b.endMin)}`}</dd>
                <dt className="font-medium text-muted-foreground">Status</dt>
                <dd className="font-semibold">{({ pending: 'Pending', confirmed: 'Confirmed', scheduled: 'Scheduled', in_service: 'In service', completed: 'Completed' } as Record<string, string>)[b.variant] ?? b.variant}</dd>
              </dl>
              {axis === 'bed' && b.draggable && !b.therapistId && staffShifts.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <label className="text-[11px] font-semibold text-muted-foreground">Assign therapist</label>
                  <select
                    className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1.5 text-sm"
                    defaultValue=""
                    onChange={(e) => {
                      const t = staffShifts.find((s) => s.id === e.target.value);
                      if (t) { doAssign(b.refId, t.id, b.startMin, t.name); setDetail(null); }
                    }}
                  >
                    <option value="" disabled>Pick a therapist…</option>
                    {staffShifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {/* People board: a bedless booking can be pinned to a bed here. The
                  options are the share group's beds that are type-compatible AND
                  free for this booking's window — the server re-checks on submit. */}
              {axis === 'person' && b.draggable && b.bedUnassigned && !b.untimed && (() => {
                const free = assignBeds.filter((bed) => {
                  const typeOk = !b.allowedResourceTypes?.length || b.allowedResourceTypes.includes(bed.type);
                  const busy = bed.busy.some((w) => b.startMin < w.e && w.s < b.endMin);
                  return typeOk && !busy;
                });
                // Nest the options Branch > Type > Area > Station (mirrors the
                // Station board's tree). A native <select> can't nest <optgroup>,
                // so each leaf group carries the full path as its label.
                const typeRank = (t: string) => { const i = STATION_ORDER.indexOf(t as typeof STATION_ORDER[number]); return i === -1 ? STATION_ORDER.length : i; };
                const groups = new Map<string, { branch: string; type: string; zone: string; beds: AssignBed[] }>();
                for (const bed of free) {
                  const zone = bed.zone ?? '';
                  const key = `${bed.branch}|${bed.type}|${zone}`;
                  if (!groups.has(key)) groups.set(key, { branch: bed.branch, type: bed.type, zone, beds: [] });
                  groups.get(key)!.beds.push(bed);
                }
                const ordered = [...groups.values()].sort((a, c) =>
                  a.branch.localeCompare(c.branch)
                  || typeRank(a.type) - typeRank(c.type) || a.type.localeCompare(c.type)
                  || a.zone.localeCompare(c.zone));
                for (const g of ordered) g.beds.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
                return (
                  <div className="mt-3 border-t border-border pt-2">
                    <label className="text-[11px] font-semibold text-muted-foreground">Assign bed</label>
                    {free.length === 0 ? (
                      <p className="mt-1 text-[12px] font-medium text-muted-foreground">No bed free for this time.</p>
                    ) : (
                      <select
                        className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1.5 text-sm"
                        defaultValue=""
                        onChange={(e) => {
                          const bed = free.find((x) => x.id === e.target.value);
                          if (bed) doAssignBed(b.refId, bed.id, b.startMin, `${bed.branch} · ${bed.name}`);
                        }}
                      >
                        <option value="" disabled>Pick a bed…</option>
                        {ordered.map((g) => (
                          <optgroup
                            key={`${g.branch}/${g.type}/${g.zone}`}
                            label={[g.branch, STATION_GROUP_LABEL[g.type] ?? g.type.replace(/_/g, ' '), g.zone].filter(Boolean).join(' · ')}
                          >
                            {g.beds.map((bed) => <option key={bed.id} value={bed.id}>{bed.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })()}
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>Close</Button>
                {b.orderId && (
                  <Button
                    size="sm"
                    variant={b.variant === 'scheduled' ? 'outline' : 'default'}
                    onClick={() => router.push(`/sales-orders/${b.orderId}`)}
                  >
                    Open order
                  </Button>
                )}
                {/* Start a not-yet-started service inline. Same guards as the order
                    page (needs service picked, therapist/bed where required, an
                    open shift) — errors surface as a toast. */}
                {b.variant === 'scheduled' && b.orderId && (
                  <Button size="sm" disabled={pending} onClick={() => doStartFromBoard(b.refId, b.orderId!)}>
                    Start
                  </Button>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Drag preview for staff cards — renders in a portal so it isn't clipped
          by the rail's overflow while dragging onto a far block. */}
      <DragOverlay dropAnimation={null}>
        {activeStaffName ? (
          <div className="flex cursor-grabbing items-center gap-2 rounded border border-primary bg-card px-2 py-1.5 text-[11px] font-bold shadow-lg">
            {activeStaffName}
          </div>
        ) : null}
      </DragOverlay>

    </DndContext>
  );
}
