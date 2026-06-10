'use client';

import { Fragment, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Users, ChevronDown, ChevronRight, BedDouble, Scissors, Hand, ExternalLink } from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn, formatPHP } from '@/lib/utils';
import { CreateOrderDialog } from '@/components/sales-orders/create-order-dialog';
import type { ReservationItem } from '@/components/reservations/new-reservation-dialog';
import { moveScheduledOrderItem, assignTherapistToOrderItem, unassignOrderItem, addTherapistBlock, removeTherapistBlock, setDailyLineup } from '@/app/(dashboard)/calendar/actions';
import { startOrderItem, finishOrderItem } from '@/app/(dashboard)/sales-orders/actions';
import { LineupList, LINEUP_DND_MIME, type LineupTherapist } from '@/components/shift-schedule/lineup-panel';

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
  /** on_call shifts get a visually distinct band so desk staff can tell them
   *  apart from regular/cross-branch roster. */
  shiftType?: string | null;
  /** Bed rows (axis='bed') carry their branch code + zone so the board can nest
   *  Branch > Type > Zone > Station. */
  branch?: string;
  zone?: string | null;
}
export type BlockVariant = 'pending' | 'confirmed' | 'scheduled' | 'in_service' | 'completed' | 'blocked';
export interface BoardBlock {
  key: string;
  kind: 'reservation' | 'order' | 'block';
  refId: string;
  bedId: string | null; // null = floating (top lane); see also `external` below
  /** Reservation is dispatched to a hotel room — never gets a bed. Renders in
   *  the External lane (above To place) and can't be dragged onto a bed. */
  external?: boolean;
  guest?: string; // booking guest name — shown at the top of the block
  pax?: number;   // group size, shown next to the guest
  /** Parent order number (SO-YYMMDD-NNNN). The detail popover's header shows its
   *  last 4 chars (the daily sequence) ahead of the guest. */
  orderNo?: string;
  /** Guest's per-order sequence (order_customers.seq_no) — the "3" in "Guest 3".
   *  Shown as the guest id in the detail popover's header. */
  guestSeq?: number | null;
  /** Total guests on the parent order (order_customers count). The popover header
   *  shows the guest as "seq/total" (which guest of how many). */
  guestTotal?: number | null;
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
  /** Order's outstanding balance in cents (total − paid). Shown in the detail
   *  popover, painted red whenever it isn't zero. */
  balanceCents?: number;
  /** This line's own pricing — list price, discount applied, and the net amount
   *  booked as revenue at Finish. Drives the Finish confirmation's discount
   *  breakdown (mirrors the order page), so the desk can check it on the board. */
  listPriceCents?: number | null;
  discountCents?: number | null;
  finalAmountCents?: number | null;
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

// Capacity / occupancy / utilization for the selected branch(es), computed
// server-side. Two occupancies (station beds, therapists) drawn per-hour over
// the ruler; one day-level utilization against the true bottleneck capacity
// min(bed-hours, therapist-hours). `computable` is false when more than one
// branch is selected and they aren't all in the same therapist share group —
// pooling therapist capacity across non-sharing branches is meaningless.
export interface BoardOccupancy {
  computable: boolean;
  note: string | null;
  // One entry per ruler hour (same placed-hour ints as the axis). Pct is 0..1
  // (can exceed 1 when overbooked); null when there's no capacity that hour.
  perHour: { hour: number; stationPct: number | null; therapistPct: number | null }[];
  bedHours: number;
  therapistHours: number;
  stationCount: number;      // active stations counted into bedHours
  therapistCount: number;    // service therapists rostered into therapistHours
  capacityHours: number;     // min(bedHours, therapistHours) — the real ceiling
  actualHours: number;       // delivered service-hours (in_service elapsed + done + interrupted)
  utilizationPct: number | null;   // actualHours / capacityHours
  stationOccPct: number | null;    // day avg occupied bed-hours / bedHours
  therapistOccPct: number | null;  // day avg occupied therapist-hours / therapistHours
  absentHours?: number;            // shift-hours lost to therapist absence blocks (People board only)
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
  // Absence block — a hatched amber band so "this person is away" reads clearly
  // and never looks like a bookable/booked service.
  blocked: 'border border-amber-600/70 bg-amber-500/25 text-amber-950 dark:text-amber-100 [background-image:repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(180,83,9,0.18)_5px,rgba(180,83,9,0.18)_10px)]',
};
// Absence-block kinds and their short labels (shared with the server's
// addTherapistBlock). The free reason text is the note; the kind is the rollup.
export const BLOCK_KINDS = ['late', 'early_leave', 'stepped_out', 'absent', 'other'] as const;
export type BlockKind = typeof BLOCK_KINDS[number];
export const BLOCK_KIND_LABEL: Record<string, string> = {
  late: 'Late', early_leave: 'Left early', stepped_out: 'Stepped out', absent: 'Absent', other: 'Other',
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

// Modal to record a therapist absence block (People board). Manages its own
// from/to + reason form; on save it hands board-minutes back to the parent.
function AbsenceDialog({
  name, windowStartMin, windowEndMin, defaultStartMin, pending, onSave, onClose,
}: {
  name: string;
  windowStartMin: number;
  windowEndMin: number;
  defaultStartMin: number;
  pending: boolean;
  onSave: (startMin: number, endMin: number, reason: string, kind: BlockKind | null) => void;
  onClose: () => void;
}) {
  const clamp = (m: number) => Math.max(windowStartMin, Math.min(windowEndMin, m));
  const [startStr, setStartStr] = useState(hhmm(clamp(defaultStartMin)));
  const [endStr, setEndStr] = useState(hhmm(clamp(defaultStartMin + 60)));
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<BlockKind | ''>('');
  // A clock time below the board's open folds to the next day (past-midnight board).
  const toBoardMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    let v = h * 60 + m;
    if (v < windowStartMin) v += 1440;
    return v;
  };
  const submit = () => {
    const s = toBoardMin(startStr); const e = toBoardMin(endStr);
    if (s == null || e == null) { toast.error('Enter a valid time'); return; }
    if (e <= s) { toast.error('End time must be after start time'); return; }
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    onSave(s, e, reason.trim(), kind || null);
  };
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Mark absent &middot; {name}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">&times;</button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-[11px] font-semibold text-muted-foreground">From</span>
              <input type="time" value={startStr} onChange={(e) => setStartStr(e.target.value)} className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1.5" />
            </label>
            <label className="flex-1">
              <span className="text-[11px] font-semibold text-muted-foreground">To</span>
              <input type="time" value={endStr} onChange={(e) => setEndStr(e.target.value)} className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1.5" />
            </label>
          </div>
          <label>
            <span className="text-[11px] font-semibold text-muted-foreground">Kind (optional)</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as BlockKind | '')} className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1.5">
              <option value="">&mdash;</option>
              {BLOCK_KINDS.map((k) => <option key={k} value={k}>{BLOCK_KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-semibold text-muted-foreground">Reason</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. went home sick" className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1.5" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={pending} onClick={submit}>Save</Button>
        </div>
      </div>
    </>
  );
}
function BedRow({
  bed, blocks, windowStartMin, trackWidth, hours, nowMin, onOpen, onEmptyClick, assignMode, onAddBlock, onAddToLineup,
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
  /** People board only: record an absence for this therapist. */
  onAddBlock?: (bed: BoardBed) => void;
  /** People board only: add this therapist to today's line-up (also enables
   *  dragging the name cell onto the line-up list). */
  onAddToLineup?: (bed: BoardBed) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bed:${bed.id}` });
  // Pack lanes by the bed-occupied span (service + cleanup tail) so a block's
  // turnover doesn't get covered by the next booking.
  const { lanes, count } = assignLanes(blocks.map((b) => ({ startMin: b.startMin, endMin: b.endMin + b.cleanupMin })));
  return (
    <div className="flex border-b border-border last:border-0">
      <div
        className="w-40 shrink-0 p-2 text-center flex flex-col justify-center gap-0.5 sticky left-0 z-20 bg-card group"
        draggable={!!onAddToLineup}
        onDragStart={onAddToLineup ? (e) => { e.dataTransfer.setData(LINEUP_DND_MIME, bed.id); e.dataTransfer.effectAllowed = "copy"; } : undefined}
      >
        <div className="font-semibold text-sm">
          {bed.name}
          {bed.shiftType === 'on_call' && <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">OC</span>}
        </div>
        {(onAddBlock || onAddToLineup) && (
          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {onAddToLineup && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onAddToLineup(bed); }} className="rounded px-1 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/10" title="Add to todays line-up">+ line-up</button>
            )}
            {onAddBlock && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onAddBlock(bed); }} className="rounded px-1 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-500/15 dark:text-amber-400" title="Mark this therapist absent for part of the day">+ absent</button>
            )}
          </div>
        )}
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
            therapist is rostered; bookings render on top.
            On-call therapists get a distinct amber band. */}
        {bed.shiftStartMin != null && bed.shiftEndMin != null && bed.shiftEndMin > bed.shiftStartMin && (
          <div
            className={`absolute top-1 bottom-1 rounded ${bed.shiftType === 'on_call' ? 'bg-amber-400/15 border border-dashed border-amber-400/40' : 'bg-primary/10'}`}
            style={{ left: (bed.shiftStartMin - windowStartMin) * PX_PER_MIN, width: (bed.shiftEndMin - bed.shiftStartMin) * PX_PER_MIN }}
            title={bed.shiftType === 'on_call' ? 'On call' : 'On shift'}
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

// ── Mobile read-only agenda ────────────────────────────────────────────────
// The desktop board is a drag-grid with nested scroll containers (rail + board)
// that trap touch on phones — you can't even scroll the page. Below `md` we
// render this instead: one vertically-scrolling, read-only list grouped by the
// row subject (therapist on the People board, station on Station). No drag, no
// rail, no nested scroll — just "what's on today" at a glance.
const AGENDA_STATUS: Record<BlockVariant, { label: string; bar: string; dot: string }> = {
  pending: { label: 'Pending', bar: 'border-l-amber-400', dot: 'bg-amber-400' },
  confirmed: { label: 'Confirmed', bar: 'border-l-violet-400', dot: 'bg-violet-400' },
  scheduled: { label: 'Scheduled', bar: 'border-l-primary', dot: 'bg-primary' },
  in_service: { label: 'In service', bar: 'border-l-blue-500', dot: 'bg-blue-500' },
  completed: { label: 'Done', bar: 'border-l-zinc-400', dot: 'bg-zinc-400' },
  blocked: { label: 'Away', bar: 'border-l-amber-500', dot: 'bg-amber-500' },
};

function AgendaCard({ block }: { block: BoardBlock }) {
  const st = AGENDA_STATUS[block.variant];
  const time = block.untimed ? 'No time yet' : `${hhmm(block.startMin)}–${hhmm(block.endMin)}`;
  return (
    <div className={cn('rounded-md border border-border border-l-4 bg-card px-3 py-2', block.needsAssignment ? 'border-l-red-500' : st.bar)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold tabular-nums">{time}</span>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', block.needsAssignment ? 'bg-red-500' : st.dot)} />
          {block.needsAssignment ? 'Needs assignment' : st.label}
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold leading-snug">{block.line1}</div>
      {block.line2 && <div className="text-xs font-medium text-muted-foreground">{block.line2}</div>}
      {(block.guest || block.orderNo || block.owing) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {block.guest && (
            <span className="font-semibold text-foreground">
              {block.guest}{block.pax && block.pax > 1 ? ` ·${block.pax}` : ''}
            </span>
          )}
          {block.orderNo && <span className="tabular-nums">#{block.orderNo.slice(-4)}</span>}
          {block.owing && <span className="font-bold text-red-600 dark:text-red-400">● {formatPHP(block.balanceCents ?? 0)}</span>}
        </div>
      )}
    </div>
  );
}

function MobileAgenda({ beds, blocks, axis, subjectLabel }: {
  beds: BoardBed[];
  blocks: BoardBlock[];
  axis: 'bed' | 'person';
  subjectLabel: string;
}) {
  // Bucket every block onto its row; a block with no row (no therapist/bed yet,
  // or one outside today's rows) falls into the Unallocated section so nothing
  // is silently dropped.
  const rowIds = new Set(beds.map((b) => b.id));
  const byRow = new Map<string, BoardBlock[]>();
  const unalloc: BoardBlock[] = [];
  for (const b of blocks) {
    if (b.bedId && rowIds.has(b.bedId)) {
      const arr = byRow.get(b.bedId) ?? [];
      arr.push(b);
      byRow.set(b.bedId, arr);
    } else {
      unalloc.push(b);
    }
  }
  // Timed first (by start), untimed last.
  const sortItems = (arr: BoardBlock[]) =>
    [...arr].sort((a, b) => (a.untimed ? 1 : 0) - (b.untimed ? 1 : 0) || a.startMin - b.startMin);
  const earliest = (arr: BoardBlock[]) => arr.find((i) => !i.untimed)?.startMin ?? Infinity;
  // Show a row when it has any booking, or (People board) when the person is on
  // shift today — an empty-but-rostered therapist still reads as "free all day".
  const rows = beds
    .map((bed) => ({ bed, items: sortItems(byRow.get(bed.id) ?? []) }))
    .filter((r) => r.items.length > 0 || (axis === 'person' && r.bed.shiftStartMin != null))
    .sort((a, b) => earliest(a.items) - earliest(b.items) || a.bed.name.localeCompare(b.bed.name));

  const nothing = unalloc.length === 0 && rows.length === 0;

  return (
    <div className="flex flex-col gap-4 md:hidden">
      {nothing && (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Nothing booked today.
        </Card>
      )}
      {unalloc.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-red-600 dark:text-red-400">
            Unallocated · {unalloc.length}
          </h3>
          {sortItems(unalloc).map((b) => <AgendaCard key={b.key} block={b} />)}
        </section>
      )}
      {rows.map(({ bed, items }) => {
        const count = items.filter((i) => i.variant !== 'blocked').length;
        const shift = axis === 'person' && bed.shiftStartMin != null && bed.shiftEndMin != null
          ? `${hhmm(bed.shiftStartMin)}–${hhmm(bed.shiftEndMin)}`
          : bed.branch && bed.branch !== '—' ? bed.branch : null;
        return (
          <section key={bed.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
              <h3 className="text-sm font-bold">
                {bed.name}
                <span className="ml-1.5 text-xs font-semibold text-muted-foreground">· {count}</span>
              </h3>
              {shift && <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{shift}</span>}
            </div>
            {items.length === 0 ? (
              <p className="px-1 py-1 text-xs font-medium italic text-muted-foreground/70">No bookings — free all day</p>
            ) : (
              items.map((b) => <AgendaCard key={b.key} block={b} />)
            )}
          </section>
        );
      })}
      <p className="pt-1 text-center text-[11px] font-medium italic text-muted-foreground/60">
        Read-only on mobile · open on a larger screen to edit the {subjectLabel.toLowerCase()} board
      </p>
    </div>
  );
}

export function ScheduleBoard({
  branchId, day, beds, blocks, windowStartMin, windowEndMin, bedCount, staffShifts, nowMin, dialog,
  axis = 'bed', subjectLabel = 'Station', assignBeds = [], occupancy, lineup = [],
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
  /** Capacity / occupancy / utilization summary for the selected branch(es).
   *  Drives the day-total strip + the two per-hour occupancy bands. */
  occupancy?: BoardOccupancy;
  /** Saved daily line-up order (therapist ids), axis='person' only. Drives the
   *  left-column line-up editor and the row sort (time > line-up > name). */
  lineup?: string[];
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
  // Finish confirmation — revenue is recognised at finish, so confirm before it,
  // carrying this line's pricing so the discount can be checked on the board.
  const [finishConfirm, setFinishConfirm] = useState<{ itemId: string; orderId: string; serviceName: string; listPriceCents: number | null; discountCents: number | null; finalAmountCents: number | null } | null>(null);
  // Station rail: 'bookings' (unallocated) vs 'staff' (on-shift therapists to
  // drag onto unassigned services). staffDragId is set while a staff card drags,
  // to light up the droppable (unassigned) blocks.
  const [railMode, setRailMode] = useState<'bookings' | 'staff'>('bookings');
  const [staffDragId, setStaffDragId] = useState<string | null>(null);
  const [activeStaffName, setActiveStaffName] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  // Add-absence dialog target (People board) — the therapist a block is being
  // recorded against, opened from the row's "absent" button.
  const [blockFor, setBlockFor] = useState<{ therapistId: string; name: string } | null>(null);

  // ── Daily line-up (person axis): a draft order committed on Save ──────────
  // The board's row sort uses the SAVED order (prop); the draft only affects the
  // left-column editor until Save persists it (then the page refreshes).
  const [draftLineup, setDraftLineup] = useState<string[]>(lineup);
  const savedLineupKey = lineup.join(',');
  useEffect(() => {
    // Re-sync the draft when the saved order changes (after Save, or a new day).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftLineup(lineup);
  }, [savedLineupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineupDirty = draftLineup.join(',') !== savedLineupKey;
  const lineupRank = new Map(lineup.map((id, i) => [id, i] as const));
  const lineupBlockedIds = new Set(blocks.filter((b) => b.variant === 'blocked' && b.therapistId).map((b) => b.therapistId!));
  const lineupById = new Map<string, LineupTherapist>(
    beds.map((b) => [b.id, {
      name: b.name,
      positionCode: b.type === '_other' ? null : b.type,
      onShift: b.shiftStartMin != null && b.shiftEndMin != null,
      blocked: lineupBlockedIds.has(b.id),
    }] as const),
  );
  const lineupAdd = (id: string) => { if (lineupById.has(id)) setDraftLineup((o) => (o.includes(id) ? o : [...o, id])); };
  const lineupRemove = (id: string) => setDraftLineup((o) => o.filter((x) => x !== id));
  const lineupToBack = (id: string) => setDraftLineup((o) => [...o.filter((x) => x !== id), id]);
  const lineupReorder = (from: number, to: number) => setDraftLineup((o) => {
    if (from === to || from < 0 || to < 0 || from >= o.length || to >= o.length) return o;
    const next = o.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m); return next;
  });
  const lineupSave = () => startTransition(async () => {
    const r = await setDailyLineup({ branch_id: branchId, day, ordered_ids: draftLineup.filter((id) => lineupById.has(id)) });
    if (r.ok) { toast.success('Line-up saved'); router.refresh(); } else toast.error(r.error);
  });

  const total = Math.max(60, windowEndMin - windowStartMin);
  const trackWidth = Math.round((total / 60) * PX_PER_HOUR);
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  // Occupancy bands: per-hour station/therapist % keyed by the same placed-hour
  // ints as the ruler, so the cells line up under their hour column.
  const occByHour = new Map((occupancy?.perHour ?? []).map((p) => [p.hour, p]));
  const occPct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const occHrs = (x: number) => `${Math.round(x * 10) / 10}`;
  // Occupied → calm under half, primary past half, amber near full, red over.
  const occTone = (p: number | null | undefined): string =>
    p == null ? 'text-muted-foreground/50'
    : p >= 1 ? 'bg-destructive/20 text-destructive font-bold'
    : p >= 0.85 ? 'bg-amber-400/25 text-amber-900 dark:text-amber-200 font-bold'
    : p >= 0.5 ? 'bg-primary/10 text-foreground font-semibold'
    : 'text-muted-foreground font-semibold';

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
    // Count real bookings only — an absence block isn't workload.
    for (const b of blocks) if (b.therapistId && b.variant !== 'blocked') m.set(b.therapistId, (m.get(b.therapistId) ?? 0) + 1);
    return m;
  })();
  // When "Available only" is on, the Staff rail follows the chosen time too:
  // keep only therapists on shift at availAt who aren't already running a
  // scheduled/in-service/confirmed block then (mirrors the hover popover's
  // "free at this minute"). Off → the whole day's roster, as before.
  const railStaffShifts = (() => {
    if (!availableOnly) return staffShifts;
    const t = availAt;
    const busyTh = new Set(
      blocks
        .filter((b) => b.therapistId && (b.variant === 'scheduled' || b.variant === 'in_service' || b.variant === 'confirmed' || b.variant === 'blocked') && t >= b.startMin && t < b.endMin)
        .map((b) => b.therapistId!),
    );
    return staffShifts.filter((s) => t >= s.startMin && t < s.endMin && !busyTh.has(s.id));
  })();
  const staffGroups = (() => {
    const byPos = new Map<string, BoardStaffShift[]>();
    for (const s of railStaffShifts) { const k = s.positionCode ?? '_other'; if (!byPos.has(k)) byPos.set(k, []); byPos.get(k)!.push(s); }
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
      if (t < bed.shiftStartMin || t >= bed.shiftEndMin) return false; // off shift at t
      // An absence block over `t` makes them unavailable even while on shift.
      return !rowBlocks.some((b) => b.variant === 'blocked' && t >= b.startMin && t < b.endMin);
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
            // Person axis: order each position group by shift start (early → mid
            // → late), off-shift rows (no band today) last, then name. Mirrors the
            // AM/Mid/PM reading of the roster instead of raw employee order.
            const sorted = trows.slice().sort((a, b) =>
              (a.shiftStartMin ?? Infinity) - (b.shiftStartMin ?? Infinity)
              || (lineupRank.get(a.id) ?? Infinity) - (lineupRank.get(b.id) ?? Infinity)
              || a.name.localeCompare(b.name));
            zones = [{ zone: '', count: sorted.length, rows: sorted }];
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
      (b.variant === 'scheduled' || b.variant === 'in_service' || b.variant === 'confirmed' || b.variant === 'blocked') &&
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
  // Clear one assignment off a not-yet-started booking from the detail popover:
  // the Station board strips the bed, the People board strips the therapist. The
  // other assignment is kept; the line drops to this board's unallocated rail.
  function doUnassign(refId: string, target: 'station' | 'therapist') {
    startTransition(async () => {
      const r = await unassignOrderItem({ item_id: refId, target });
      if (r.ok) { toast.success(target === 'station' ? 'Station unassigned' : 'Therapist unassigned'); setDetail(null); router.refresh(); }
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
  // Finish an in-service line straight from the board — stamps the end time, same
  // action as the order page's Finish.
  function doFinishFromBoard(itemId: string, orderId: string) {
    startTransition(async () => {
      const r = await finishOrderItem(itemId, orderId);
      if (r.ok) { toast.success('Service finished'); setDetail(null); router.refresh(); }
      else toast.error(r.error);
    });
  }
  // Record / clear a therapist absence block from the People board.
  function doAddBlock(employeeId: string, startMin: number, endMin: number, reason: string, kind: BlockKind | null) {
    startTransition(async () => {
      const r = await addTherapistBlock({ employee_id: employeeId, day, start_min: startMin, end_min: endMin, reason, block_kind: kind });
      if (r.ok) { toast.success('Absence recorded'); setBlockFor(null); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function doRemoveBlock(blockId: string) {
    startTransition(async () => {
      const r = await removeTherapistBlock(blockId);
      if (r.ok) { toast.success('Absence removed'); setDetail(null); router.refresh(); }
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

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={clearStaffDrag}>
      {/* Day-total capacity strip: the headline Utilization against the true
          bottleneck min(bed-hours, therapist-hours), with the two occupancies
          alongside. Per-hour detail rides the bands under the ruler below. */}
      {occupancy && (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
          {occupancy.computable ? (
            <div className="flex flex-wrap items-baseline gap-x-7 gap-y-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Utilization</span>
                <span className={`text-lg font-extrabold tabular-nums ${occupancy.utilizationPct != null && occupancy.utilizationPct >= 0.85 ? 'text-primary' : 'text-foreground'}`}>{occPct(occupancy.utilizationPct)}</span>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">({occHrs(occupancy.actualHours)} service hr)</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Therapist</span>
                <span className="text-base font-extrabold tabular-nums text-foreground">{occPct(occupancy.therapistOccPct)}</span>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">({occupancy.therapistCount} pax - {occHrs(occupancy.therapistHours)} available hr)</span>
                {occupancy.absentHours != null && occupancy.absentHours > 0 && (
                  <span className="text-xs font-bold text-red-600 tabular-nums dark:text-red-400">· {occHrs(occupancy.absentHours)} absent hr</span>
                )}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Station</span>
                <span className="text-base font-extrabold tabular-nums text-foreground">{occPct(occupancy.stationOccPct)}</span>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">({occupancy.stationCount} st. - {occHrs(occupancy.bedHours)} available hr)</span>
              </div>
              <span className="w-full text-[11px] font-medium italic text-muted-foreground/80">
                Utilization = Service Hour / min available hour between Therapist and Station
              </span>
            </div>
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">Occupancy &amp; utilization unavailable — {occupancy.note}</p>
          )}
        </div>
      )}
      {/* MOBILE — the desktop board below traps touch (nested scrollers); on
          phones show a read-only agenda grouped by row subject instead. */}
      <MobileAgenda beds={beds} blocks={blocks} axis={axis} subjectLabel={subjectLabel} />

      <div className="hidden md:flex items-start gap-3">
      {/* LEFT RAIL — everything with no bed yet; drag a card onto a bed row. */}
      <div className="w-56 shrink-0 flex flex-col gap-3">
      {axis === "person" && (
        <LineupList
          order={draftLineup}
          byId={lineupById}
          dirty={lineupDirty}
          pending={pending}
          onReorder={lineupReorder}
          onRemove={lineupRemove}
          onToBack={lineupToBack}
          onAdd={lineupAdd}
          onSave={lineupSave}
          onReset={() => setDraftLineup(lineup)}
          onClear={() => setDraftLineup([])}
        />
      )}
      <Card className="overflow-y-auto p-0 max-h-[calc(100vh-16rem)]">
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
              ? availableOnly
                ? `${railStaffShifts.length} free at ${hhmm(availAt)} · drag onto an unassigned service`
                : `${railStaffShifts.length} on shift · drag onto an unassigned service`
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
            railStaffShifts.length === 0 ? (
              <p className="py-6 text-center text-[11px] font-semibold italic text-muted-foreground/70">
                {availableOnly && staffShifts.length > 0 ? `No therapist free at ${hhmm(availAt)}` : 'No staff on shift'}
              </p>
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
      </div>

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

          {/* Per-hour occupancy bands — station beds then therapists, each cell
              the % of that resource's capacity booked in the hour (occupancy
              includes scheduled). Only shown when computable for the selection. */}
          {occupancy?.computable && (['therapist', 'station'] as const).map((kind) => (
            <div key={kind} className="flex border-b border-border bg-card">
              <div className="w-40 shrink-0 px-2 py-1 flex items-center justify-between gap-1 sticky left-0 z-20 bg-card">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{kind === 'station' ? 'Station occ' : 'Therapist occ'}</span>
                <span className="text-[10px] font-extrabold tabular-nums text-foreground/80">{occPct(kind === 'station' ? occupancy.stationOccPct : occupancy.therapistOccPct)}</span>
              </div>
              <div className="relative" style={{ height: 22, minWidth: trackWidth }}>
                {hours.slice(0, -1).map((h) => {
                  const p = occByHour.get(h);
                  const v = kind === 'station' ? p?.stationPct : p?.therapistPct;
                  return (
                    <div key={h} className="absolute top-0 bottom-0 flex items-center justify-center border-l border-border/30" style={{ left: (h * 60 - windowStartMin) * PX_PER_MIN, width: PX_PER_HOUR }}>
                      <span className={`flex h-[18px] min-w-[34px] items-center justify-center rounded px-1 text-[10px] tabular-nums ${occTone(v)}`}>
                        {v == null ? '·' : `${Math.round(v * 100)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

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
                                <BedRow key={bed.id} bed={bed} blocks={blocksByBed.get(bed.id) ?? []} windowStartMin={windowStartMin} trackWidth={trackWidth} hours={hours} nowMin={nowMin} onOpen={openBlock} onEmptyClick={onEmptyClick} assignMode={staffDragId != null} onAddBlock={axis === 'person' ? (b) => setBlockFor({ therapistId: b.id, name: b.name }) : undefined} onAddToLineup={axis === 'person' ? (b) => lineupAdd(b.id) : undefined} />
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

      {add && (
        <CreateOrderDialog
          key={addKey}
          dialog={dialog}
          initialBranchId={branchId}
          prefillStartIso={addStartIso}
          // Bed axis pins the clicked bed on the first guest's line; person axis
          // pre-assigns the clicked therapist and leaves the bed to be picked later.
          prefillResourceId={axis === 'person' ? null : add.bedId}
          prefillTherapistId={axis === 'person' ? add.bedId : null}
          prefillLabel={addRow?.name ?? null}
          open
          onOpenChange={(o) => { if (!o) { setAdd(null); router.refresh(); } }}
        />
      )}

      {/* Click-a-block detail popover — anchored at the click point; a full-screen
          backdrop closes it. Summary first; "Open order" to actually go in. */}
      {detail && detail.block.kind !== 'block' && (() => {
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
                {/* Header: order# last 4 (daily seq) - guest seq/total - guest name.
                    The middle shows which guest of how many on the order (e.g.
                    "2/3"); falls back to the service when there's no number/guest. */}
                <span className="font-bold text-sm truncate">
                  {[
                    b.orderNo ? b.orderNo.slice(-4) : null,
                    b.guestSeq != null
                      ? (b.guestTotal != null ? `${b.guestSeq}/${b.guestTotal}` : String(b.guestSeq))
                      : null,
                    b.guest,
                  ].filter(Boolean).join(' - ') || b.line1}
                </span>
                <div className="flex shrink-0 items-center gap-3 pl-1">
                  {/* Open the parent order — an icon up here instead of a footer button. */}
                  {b.orderId && (
                    <a
                      href={`/sales-orders/${b.orderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="Open order in a new tab"
                      aria-label="Open order in a new tab"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                  <button type="button" onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">✕</button>
                </div>
              </div>
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-[13px]">
                <dt className="font-medium text-muted-foreground">Status</dt>
                <dd className="font-semibold">{({ pending: 'Pending', confirmed: 'Confirmed', scheduled: 'Scheduled', in_service: 'In service', completed: 'Completed' } as Record<string, string>)[b.variant] ?? b.variant}</dd>
                {b.line2 && (
                  <>
                    <dt className="font-medium text-muted-foreground">{axis === 'person' ? 'Detail' : 'Therapist'}</dt>
                    <dd className="font-semibold truncate">{b.line2}</dd>
                  </>
                )}
                <dt className="font-medium text-muted-foreground">Service</dt>
                <dd className="font-semibold truncate">{b.line1}</dd>
                <dt className="font-medium text-muted-foreground">Time</dt>
                <dd className="font-semibold tabular-nums">{b.untimed ? 'No time yet' : `${hhmm(b.startMin)}–${hhmm(b.endMin)}`}</dd>
                {/* Outstanding balance (total − paid). Red whenever it isn't zero
                    so the desk can spot an unsettled order at a glance. */}
                {b.balanceCents != null && (
                  <>
                    <dt className="font-medium text-muted-foreground">Balance</dt>
                    <dd className={cn('font-semibold tabular-nums', b.balanceCents !== 0 && 'text-red-600 dark:text-red-400')}>
                      {formatPHP(b.balanceCents)}
                    </dd>
                  </>
                )}
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
                {/* Unassign — Station board strips the bed (only when one is set),
                    People board strips the therapist. Sends the line back to this
                    board's unallocated rail; the other assignment is kept. */}
                {b.variant === 'scheduled' && b.orderId && b.draggable && (axis === 'bed' ? !b.bedUnassigned : !!b.therapistId) && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => doUnassign(b.refId, axis === 'bed' ? 'station' : 'therapist')}>
                    Unassign
                  </Button>
                )}
                {/* Start a not-yet-started service inline. Same guards as the order
                    page (needs service picked, therapist/bed where required, an
                    open shift) — errors surface as a toast. Hidden until the
                    booking is complete: a therapist, a station/bed (on-site), and
                    a booked start time. Incomplete blocks already paint red. */}
                {b.variant === 'scheduled' && b.orderId && !b.needsAssignment && !b.bedUnassigned && !b.untimed && (
                  <Button size="sm" disabled={pending} onClick={() => doStartFromBoard(b.refId, b.orderId!)}>
                    Start
                  </Button>
                )}
                {/* Finish an in-service line — stamps the end time, same as the
                    order page's Finish. */}
                {b.variant === 'in_service' && b.orderId && (
                  <Button size="sm" disabled={pending} onClick={() => setFinishConfirm({ itemId: b.refId, orderId: b.orderId!, serviceName: b.line1, listPriceCents: b.listPriceCents ?? null, discountCents: b.discountCents ?? null, finalAmountCents: b.finalAmountCents ?? null })}>
                    Finish
                  </Button>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Absence block detail — reason + remove (People board). */}
      {detail && detail.block.kind === 'block' && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDetail(null)} />
          <div
            className="fixed z-50 w-60 rounded-lg border border-border bg-card p-3 shadow-xl"
            style={{ left: detail.x, top: detail.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-border pb-1.5 mb-2">
              <span className="font-bold text-sm text-amber-700 dark:text-amber-400">Absent</span>
              <button type="button" onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">&times;</button>
            </div>
            <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 text-[13px]">
              {detail.block.line2 && (<><dt className="font-medium text-muted-foreground">Kind</dt><dd className="font-semibold">{detail.block.line2}</dd></>)}
              <dt className="font-medium text-muted-foreground">Time</dt>
              <dd className="font-semibold tabular-nums">{hhmm(detail.block.startMin)}&ndash;{hhmm(detail.block.endMin)}</dd>
              <dt className="font-medium text-muted-foreground">Reason</dt>
              <dd className="font-semibold break-words">{detail.block.line1}</dd>
            </dl>
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => doRemoveBlock(detail.block.refId)}>Remove</Button>
            </div>
          </div>
        </>
      )}

      {/* Record-absence dialog (People board "+ absent" on a therapist row). */}
      {blockFor && (
        <AbsenceDialog
          name={blockFor.name}
          windowStartMin={windowStartMin}
          windowEndMin={windowEndMin}
          defaultStartMin={availAt}
          pending={pending}
          onSave={(s, e, reason, kind) => doAddBlock(blockFor.therapistId, s, e, reason, kind)}
          onClose={() => setBlockFor(null)}
        />
      )}
      <AlertDialog open={!!finishConfirm} onOpenChange={(o) => { if (!o) setFinishConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish {finishConfirm?.serviceName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm the discount is correct — this final amount is booked as revenue now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">List price</span><span className="tabular-nums font-medium">{formatPHP(finishConfirm?.listPriceCents)}</span></div>
            {(finishConfirm?.discountCents ?? 0) > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums font-medium text-red-600 dark:text-red-400">−{formatPHP(finishConfirm?.discountCents)}</span></div>
            )}
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-bold"><span>Revenue to book</span><span className="tabular-nums">{formatPHP(finishConfirm?.finalAmountCents)}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (finishConfirm) doFinishFromBoard(finishConfirm.itemId, finishConfirm.orderId); setFinishConfirm(null); }}
            >
              Finish &amp; book {formatPHP(finishConfirm?.finalAmountCents)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
