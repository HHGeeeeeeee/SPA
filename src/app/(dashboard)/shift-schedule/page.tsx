import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { ShiftCell, type ShiftData } from '@/components/shift-schedule/shift-cell';
import { DayTimeline, type DayRow, type ReservationBlock } from '@/components/shift-schedule/day-timeline';
import { ScheduleBoard, type BoardBed, type BoardBlock, type BlockVariant, type BoardDialogData } from '@/components/shift-schedule/schedule-board';
import { DispatchBoard } from '@/components/shift-schedule/dispatch-board';
import { TherapistsNowCard } from '@/components/shift-schedule/therapists-now-card';
import { BedsNowCard } from '@/components/shift-schedule/beds-now-card';
import { BulkShiftDialog } from '@/components/shift-schedule/bulk-shift-dialog';
import type { ReservationItem } from '@/components/reservations/new-reservation-dialog';
import { getReservationGraceMinutes, isReservationOverdue } from '@/lib/reservations';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { currentSession, isManager } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const TIMED = ['regular', 'cross_branch', 'on_call'];

type ShiftView = 'employee' | 'station' | 'dispatch';
type ShiftScale = 'week' | 'day';

function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function timeToMin(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}
function tsToMin(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
function hm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Day (hourly) view for either subject. Therapist rows show each rostered
// therapist's working window + their actual service blocks; Station rows show
// each bed's occupancy from actual service times.
async function fetchDayData(subject: ShiftView, branchId: string, day: string): Promise<{ rows: DayRow[]; windowStartMin: number; windowEndMin: number; reservations: ReservationBlock[] }> {
  const supabase = createServiceClient();
  const { data: itemData } = await supabase
    .from('order_items')
    .select('id, therapist_id, resource_id, actual_start, actual_end, bed_released_at, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), therapist:employees!order_items_therapist_id_fkey ( name, employee_code ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date, status )')
    .not('actual_start', 'is', null);
  const dayItems = (itemData ?? []).filter((it) => {
    const ord = one(it.order);
    return ord && ord.branch_id === branchId && ord.service_date === day && ord.status !== 'void' && it.actual_start;
  });

  // Upcoming reservations (not yet converted to an order) for this branch/day.
  // Unpinned ones ride the top "Reservations" lane; ones with pinned beds show
  // as ghost blocks in those bed rows (Station view only).
  const { data: resvData } = await supabase
    .from('reservations')
    .select('id, status, guest_name, pax, desired_service_start, desired_service_end, service_location_type, customer_sources ( code ), service:service_items ( prep_before_minutes, cleanup_after_minutes ), reservation_service_categories ( service_categories ( name ) ), reservation_resources ( resource_id )')
    .eq('branch_id', branchId)
    .in('status', ['reserved', 'confirmed'])
    .is('deleted_at', null)
    .gte('desired_service_start', `${day}T00:00:00+08:00`)
    .lte('desired_service_start', `${day}T23:59:59+08:00`)
    .order('desired_service_start');
  const graceMin = await getReservationGraceMinutes();
  const resvRows = (resvData ?? []).map((r) => {
    const cats = (r.reservation_service_categories ?? []).map((l) => one(l.service_categories)?.name).filter(Boolean).join(' + ');
    const src = one(r.customer_sources)?.code;
    // Bed occupancy = booked window widened by the service's prep (before) +
    // cleanup (after). 0 when no specific service was chosen on the booking.
    const prepMin = one(r.service)?.prep_before_minutes ?? 0;
    const cleanupMin = one(r.service)?.cleanup_after_minutes ?? 0;
    const endMin = tsToMin(r.desired_service_end);
    return {
      id: r.id,
      guest: r.guest_name ?? 'Guest',
      line2: [cats || 'Service', src, r.pax > 1 ? `${r.pax}p` : null].filter(Boolean).join(' · '),
      startMin: Math.max(0, tsToMin(r.desired_service_start) - prepMin),
      endMin,
      cleanupEndMin: cleanupMin > 0 ? Math.min(1439, endMin + cleanupMin) : undefined,
      external: r.service_location_type === 'external_hotel',
      pinnedIds: (r.reservation_resources ?? []).map((x) => x.resource_id),
      // Pending (reserved) is tentative — it doesn't hold a bed yet, so it never
      // becomes a bed ghost; only a confirmed reservation does.
      pending: r.status === 'reserved',
      // Overdue → bed auto-released, so it leaves its bed row for the top lane.
      overdue: isReservationOverdue({ desiredStartIso: r.desired_service_start, graceMin }),
    };
  });

  let rows: DayRow[];
  if (subject === 'station') {
    const { data: stations } = await supabase
      .from('resources').select('id, resource_name').eq('branch_id', branchId).eq('status', 'active').order('resource_name');
    const byStation = new Map<string, { line1: string; line2?: string; startMin: number; endMin: number; ongoing: boolean; cleanupEndMin?: number; itemId?: string; orderId?: string; reservation?: boolean; reservationId?: string }[]>();
    const nowMs = Date.now();
    for (const it of dayItems) {
      if (!it.resource_id) continue;
      // Occupancy = prep (before the service start) + service + cleanup (after).
      const prepMin = one(it.service)?.prep_before_minutes ?? 0;
      const s0 = tsToMin(it.actual_start!);
      const startMin = Math.max(0, s0 - prepMin);
      const endMin = it.actual_end ? tsToMin(it.actual_end) : Math.min(1439, s0 + (it.duration_minutes ?? 60));
      // A finished line still holds the bed for cleanup_after_minutes (unless
      // released early). Only show it while the buffer hasn't elapsed.
      const cleanupMin = one(it.service)?.cleanup_after_minutes ?? 0;
      let cleanupEndMin: number | undefined;
      let itemId: string | undefined;
      if (it.actual_end && cleanupMin > 0 && !it.bed_released_at
          && Date.parse(it.actual_end) + cleanupMin * 60000 > nowMs) {
        cleanupEndMin = Math.min(1439, endMin + cleanupMin);
        itemId = it.id;
      }
      // Station rows: who is on the bed (line 1) + which service (line 2).
      const svcName = one(it.service)?.name ?? 'Service';
      const thName = one(it.therapist)?.name ?? null;
      const arr = byStation.get(it.resource_id) ?? [];
      arr.push({ line1: thName ?? svcName, line2: thName ? svcName : undefined, startMin, endMin, ongoing: !it.actual_end, cleanupEndMin, itemId, orderId: one(it.order)?.id });
      byStation.set(it.resource_id, arr);
    }
    // Pinned reservations show as ghost blocks in their bed rows — but only when
    // confirmed (pending doesn't hold a bed) and not overdue (bed auto-released).
    for (const rr of resvRows) {
      if (rr.overdue || rr.pending) continue;
      for (const rid of rr.pinnedIds) {
        const arr = byStation.get(rid) ?? [];
        arr.push({ line1: rr.guest, line2: rr.line2, startMin: rr.startMin, endMin: rr.endMin, cleanupEndMin: rr.cleanupEndMin, ongoing: false, reservation: true, reservationId: rr.id });
        byStation.set(rid, arr);
      }
    }
    rows = (stations ?? []).map((s) => ({
      id: s.id, name: s.resource_name, code: '', shiftType: 'regular',
      shiftStartMin: null, shiftEndMin: null, services: byStation.get(s.id) ?? [],
    }));
  } else {
    const [shiftsRes, resRes] = await Promise.all([
      supabase
        .from('employee_shifts')
        .select('employee_id, shift_type, shift_start, shift_end, employees:employee_id ( name, employee_code )')
        .eq('branch_id', branchId).eq('shift_date', day).in('shift_type', TIMED),
      supabase.from('resources').select('id, resource_name').eq('branch_id', branchId),
    ]);
    const shifts = shiftsRes.data;
    const resName = new Map((resRes.data ?? []).map((r) => [r.id, r.resource_name]));
    const byTherapist = new Map<string, { line1: string; line2?: string; startMin: number; endMin: number; ongoing: boolean; orderId?: string }[]>();
    const empMeta = new Map<string, { name: string; code: string }>();
    for (const it of dayItems) {
      if (!it.therapist_id) continue;
      const th = one(it.therapist);
      empMeta.set(it.therapist_id, { name: th?.name ?? '—', code: th?.employee_code ?? '' });
      const startMin = tsToMin(it.actual_start!);
      // Therapists carry no prep/cleanup buffer (that's the bed's turnover, not
      // the person's) — their block is the pure service window.
      const endMin = it.actual_end ? tsToMin(it.actual_end) : Math.min(1439, startMin + (it.duration_minutes ?? 60));
      // Therapist rows already name the therapist, so the block leads with the
      // service (line 1) and the bed it is on (line 2).
      const svc = one(it.service)?.name ?? 'Service';
      const bed = it.resource_id ? resName.get(it.resource_id) : null;
      const arr = byTherapist.get(it.therapist_id) ?? [];
      arr.push({ line1: svc, line2: bed ?? undefined, startMin, endMin, ongoing: !it.actual_end, orderId: one(it.order)?.id });
      byTherapist.set(it.therapist_id, arr);
    }
    const shiftEmpIds = new Set((shifts ?? []).map((s) => s.employee_id));
    rows = (shifts ?? []).map((s) => {
      const emp = one(s.employees);
      return {
        id: s.employee_id, name: emp?.name ?? '—', code: emp?.employee_code ?? '', shiftType: s.shift_type,
        shiftStartMin: timeToMin(s.shift_start), shiftEndMin: timeToMin(s.shift_end),
        services: byTherapist.get(s.employee_id) ?? [],
      };
    });
    // Therapists serving today without a rostered shift (e.g. borrowed, or shift
    // never set) still appear, with no shift bar but their service blocks.
    for (const [tid, blocks] of byTherapist) {
      if (shiftEmpIds.has(tid)) continue;
      const meta = empMeta.get(tid);
      rows.push({
        id: tid, name: meta?.name ?? '—', code: meta?.code ?? '', shiftType: 'regular',
        shiftStartMin: null, shiftEndMin: null, services: blocks,
      });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
  }

  const allMins: number[] = [];
  for (const r of rows) {
    if (r.shiftStartMin != null) allMins.push(r.shiftStartMin);
    if (r.shiftEndMin != null) allMins.push(r.shiftEndMin);
    for (const s of r.services) {
      allMins.push(s.startMin, s.endMin);
      if (s.cleanupEndMin != null) allMins.push(s.cleanupEndMin);
    }
  }
  // Top lane: pending (never holds a bed), unpinned, and overdue reservations
  // (released beds); the Therapist view has no bed binding, so it lists them all.
  // External (hotel-dispatched) bookings are filtered out — they belong to the
  // dedicated Dispatch view, not the in-store Station/Therapist boards.
  const inStoreRows = resvRows.filter((r) => !r.external);
  const reservations: ReservationBlock[] = (subject === 'station' ? inStoreRows.filter((r) => r.pending || r.pinnedIds.length === 0 || r.overdue) : inStoreRows)
    .map((r) => ({ id: r.id, guest: r.guest, line2: r.line2, startMin: r.startMin, endMin: r.endMin, external: r.external, overdue: r.overdue, pending: r.pending }));
  for (const r of reservations) allMins.push(r.startMin, r.endMin);
  const windowStartMin = allMins.length ? Math.min(540, Math.floor(Math.min(...allMins) / 60) * 60) : 540;
  const windowEndMin = allMins.length ? Math.max(1320, Math.ceil(Math.max(...allMins) / 60) * 60) : 1320;
  return { rows, windowStartMin, windowEndMin, reservations };
}

// Interactive Station board (15-min): beds as rows, with every scheduled /
// in-service / done order item on its bed, pinned reservations as bed blocks,
// and unplaced reservations in the "To place" lane (drag onto a bed).
async function fetchStationBoard(branchId: string, day: string): Promise<{ beds: BoardBed[]; blocks: BoardBlock[]; windowStartMin: number; windowEndMin: number; bedCount: number; shiftWindows: { startMin: number; endMin: number }[] }> {
  const supabase = createServiceClient();
  const [bedsRes, itemsRes, resvRes, shiftRes, graceMin] = await Promise.all([
    supabase.from('resources').select('id, resource_name').eq('branch_id', branchId).eq('status', 'active').order('resource_name'),
    supabase
      .from('order_items')
      .select('id, status, resource_id, actual_start, actual_end, scheduled_start, service_start, slot_start, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date, status, order_customers ( id ) )')
      .in('status', ['scheduled', 'in_service', 'service_completed', 'feedback_done', 'interrupted'])
      .not('resource_id', 'is', null),
    supabase
      .from('reservations')
      .select('id, status, branch_id, source_id, guest_name, guest_phone, pax, gender_preference, service_location_type, note, seat_together, service_item_id, desired_service_start, desired_service_end, service:service_items ( prep_before_minutes, cleanup_after_minutes ), customer_sources ( code ), reservation_service_categories ( service_category_id, service_categories ( name ) ), reservation_resources ( resource_id )')
      .eq('branch_id', branchId).in('status', ['reserved', 'confirmed']).is('deleted_at', null)
      .gte('desired_service_start', `${day}T00:00:00+08:00`).lte('desired_service_start', `${day}T23:59:59+08:00`).order('desired_service_start'),
    supabase.from('employee_shifts').select('shift_start, shift_end').eq('branch_id', branchId).eq('shift_date', day).in('shift_type', ['regular', 'cross_branch', 'on_call']),
    getReservationGraceMinutes(),
  ]);

  const beds: BoardBed[] = (bedsRes.data ?? []).map((b) => ({ id: b.id, name: b.resource_name }));
  const blocks: BoardBlock[] = [];
  const mins: number[] = [];

  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || ord.branch_id !== branchId || ord.service_date !== day || ord.status === 'void' || !it.resource_id) continue;
    const dur = it.duration_minutes ?? 60;
    let startMin: number;
    let endMin: number;
    let variant: BlockVariant;
    let draggable = false;
    if (it.status === 'scheduled') {
      const sIso = it.scheduled_start ?? it.service_start ?? it.slot_start;
      if (!sIso) continue; // no planned time → can't place it on the axis
      startMin = tsToMin(sIso); endMin = startMin + dur; variant = 'scheduled'; draggable = true;
    } else {
      if (!it.actual_start) continue;
      startMin = tsToMin(it.actual_start);
      endMin = it.actual_end ? tsToMin(it.actual_end) : startMin + dur;
      // Finished / interrupted lines render as the greyed "completed" block (they
      // still hold the bed through the cleanup buffer); only a live one is in_service.
      variant = it.status === 'in_service' ? 'in_service' : 'completed';
    }
    const pax = (ord as unknown as { order_customers?: { id: string }[] }).order_customers?.length ?? 1;
    blocks.push({
      key: `oi:${it.id}`, kind: 'order', refId: it.id, bedId: it.resource_id,
      guest: one(it.guest)?.customer_name ?? undefined, pax,
      line1: one(it.service)?.name ?? 'Service', line2: one(it.therapist)?.name ?? undefined,
      startMin, endMin, durationMin: dur,
      prepMin: one(it.service)?.prep_before_minutes ?? 0,
      cleanupMin: one(it.service)?.cleanup_after_minutes ?? 0,
      variant, draggable, orderId: ord.id,
    });
    mins.push(startMin, endMin);
  }

  for (const r of resvRes.data ?? []) {
    // External (hotel-dispatched) reservations belong to the Dispatch view —
    // they never get a bed, and they shouldn't clutter "To place" in Station.
    if (r.service_location_type === 'external_hotel') continue;
    const cats = (r.reservation_service_categories ?? []).map((l) => one(l.service_categories)?.name).filter(Boolean).join(' + ');
    const src = one(r.customer_sources)?.code;
    const startMin = tsToMin(r.desired_service_start);
    const endMin = Math.max(startMin + 15, tsToMin(r.desired_service_end));
    const dur = Math.max(15, endMin - startMin);
    const pinnedIds = (r.reservation_resources ?? []).map((x) => x.resource_id);
    const pending = r.status === 'reserved';
    const overdue = isReservationOverdue({ desiredStartIso: r.desired_service_start, graceMin });
    const prepMin = one(r.service)?.prep_before_minutes ?? 0;
    const cleanupMin = one(r.service)?.cleanup_after_minutes ?? 0;
    // Full record so the board can open this reservation in the edit dialog.
    const editData: ReservationItem = {
      id: r.id,
      branch_id: r.branch_id,
      source_id: r.source_id,
      service_category_ids: (r.reservation_service_categories ?? []).map((l) => l.service_category_id),
      guest_name: r.guest_name ?? '',
      guest_phone: r.guest_phone,
      pax: r.pax,
      gender_preference: r.gender_preference,
      service_location_type: r.service_location_type,
      note: r.note,
      desired_service_start: r.desired_service_start,
      desired_service_end: r.desired_service_end,
      resource_ids: pinnedIds,
      seat_together: r.seat_together,
      service_item_id: r.service_item_id,
    };
    // A confirmed booking pinned to a bed STAYS on that bed even if it's past
    // its grace window — staff put it there on purpose; show it (with a late
    // mark) rather than yanking it to the "To place" lane. Only pending or
    // un-pinned reservations live in the lane.
    const guest = `${overdue ? '⚠ ' : ''}${r.guest_name ?? 'Guest'}`;
    const floating = pending || pinnedIds.length === 0;
    if (floating) {
      blocks.push({ key: `res:${r.id}`, kind: 'reservation', refId: r.id, bedId: null, guest, pax: r.pax, line1: cats || 'Service', line2: src ?? undefined, startMin, endMin, durationMin: dur, prepMin, cleanupMin, variant: pending ? 'pending' : 'confirmed', draggable: true, editData });
    } else {
      for (const rid of pinnedIds) {
        blocks.push({ key: `res:${r.id}:${rid}`, kind: 'reservation', refId: r.id, bedId: rid, guest, pax: r.pax, line1: cats || 'Service', line2: src ?? undefined, startMin, endMin, durationMin: dur, prepMin, cleanupMin, variant: 'confirmed', draggable: true, editData });
      }
    }
    mins.push(startMin, endMin);
  }

  const windowStartMin = mins.length ? Math.min(540, Math.floor(Math.min(...mins) / 60) * 60) : 540;
  const windowEndMin = mins.length ? Math.max(1320, Math.ceil(Math.max(...mins) / 60) * 60) : 1320;
  const shiftWindows = (shiftRes.data ?? [])
    .map((s) => ({ startMin: timeToMin(s.shift_start), endMin: timeToMin(s.shift_end) }))
    .filter((w): w is { startMin: number; endMin: number } => w.startMin != null && w.endMin != null);
  return { beds, blocks, windowStartMin, windowEndMin, bedCount: beds.length, shiftWindows };
}

// Dispatch view: external (hotel-dispatched) reservations for the day. They
// don't get a bed (therapist travels), so this is a list focused on "who goes
// where at what time" — guest, source/hotel code, room number, pax, status.
export interface DispatchRow {
  id: string;
  guest_name: string;
  guest_phone: string | null;
  pax: number;
  source_code: string | null;
  external_room_no: string | null;
  desired_service_start: string;
  desired_service_end: string;
  status: string;
  note: string | null;
  service_categories: string;
  editData: ReservationItem;
}
async function fetchDispatchData(branchId: string, day: string): Promise<DispatchRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('reservations')
    .select('id, status, branch_id, source_id, guest_name, guest_phone, pax, gender_preference, service_location_type, note, seat_together, service_item_id, external_room_no, desired_service_start, desired_service_end, customer_sources ( code, name ), reservation_service_categories ( service_category_id, service_categories ( name ) ), reservation_resources ( resource_id )')
    .eq('branch_id', branchId)
    .eq('service_location_type', 'external_hotel')
    .in('status', ['reserved', 'confirmed'])
    .is('deleted_at', null)
    .gte('desired_service_start', `${day}T00:00:00+08:00`)
    .lte('desired_service_start', `${day}T23:59:59+08:00`)
    .order('desired_service_start');
  return (data ?? []).map((r) => {
    const src = one(r.customer_sources);
    const editData: ReservationItem = {
      id: r.id,
      branch_id: r.branch_id,
      source_id: r.source_id,
      service_category_ids: (r.reservation_service_categories ?? []).map((l) => l.service_category_id),
      guest_name: r.guest_name ?? '',
      guest_phone: r.guest_phone,
      pax: r.pax,
      gender_preference: r.gender_preference,
      service_location_type: r.service_location_type,
      note: r.note,
      desired_service_start: r.desired_service_start,
      desired_service_end: r.desired_service_end,
      resource_ids: (r.reservation_resources ?? []).map((x) => x.resource_id),
      seat_together: r.seat_together,
      service_item_id: r.service_item_id,
    };
    return {
      id: r.id,
      guest_name: r.guest_name ?? 'Guest',
      guest_phone: r.guest_phone,
      pax: r.pax,
      source_code: src?.code ?? null,
      external_room_no: r.external_room_no,
      desired_service_start: r.desired_service_start,
      desired_service_end: r.desired_service_end,
      status: r.status,
      note: r.note,
      service_categories: (r.reservation_service_categories ?? []).map((l) => one(l.service_categories)?.name).filter(Boolean).join(' + '),
      editData,
    };
  });
}

// Quick count for the Dispatch tab badge — cheaper than fetchDispatchData when
// the user isn't on the Dispatch tab.
async function fetchDispatchCount(branchId: string, day: string): Promise<number> {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('service_location_type', 'external_hotel')
    .in('status', ['reserved', 'confirmed'])
    .is('deleted_at', null)
    .gte('desired_service_start', `${day}T00:00:00+08:00`)
    .lte('desired_service_start', `${day}T23:59:59+08:00`);
  return count ?? 0;
}

// Option lists for the board's click-to-add (reuses NewReservationDialog).
async function fetchBoardDialogData(): Promise<BoardDialogData> {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const [br, src, cat, si] = await Promise.all([
    supabase.from('branches').select('id, code, name, branch_business_units ( business_unit_id )').eq('active', true).order('code'),
    supabase.from('customer_sources').select('id, code, name, phone_required').eq('active', true).order('code'),
    supabase.from('service_categories').select('id, code, name, required_resource_type, service_category_business_units ( business_unit_id )').eq('active', true).order('code'),
    supabase.from('service_items').select('id, name, service_group, service_category_id, duration_minutes').eq('active', true).order('service_group'),
  ]);
  const branches = (br.data ?? []).filter((b) => allowed.has(b.id)).map((b) => ({
    id: b.id, code: b.code, name: b.name, businessUnitIds: (b.branch_business_units ?? []).map((x) => x.business_unit_id),
  }));
  const serviceCategories = (cat.data ?? []).map((c) => ({
    id: c.id, code: c.code, name: c.name,
    businessUnitIds: (c.service_category_business_units ?? []).map((x) => x.business_unit_id),
    requiredResourceType: c.required_resource_type,
  }));
  const serviceItems = (si.data ?? [])
    .filter((s) => s.service_group)
    .map((s) => ({ id: s.id, name: s.name, group: s.service_group as string, categoryId: s.service_category_id as string, durationMinutes: s.duration_minutes ?? null }));
  return { branches, sources: src.data ?? [], serviceCategories, serviceItems };
}

interface ShiftRow {
  employee_id: string;
  shift_date: string;
  shift_type: string;
  shift_start: string | null;
  shift_end: string | null;
  leave_type: string | null;
}

function thisMonday(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - day);
  return now.toISOString().slice(0, 10);
}

function weekDays(monday: string): { date: string; label: string; dow: string }[] {
  const out: { date: string; label: string; dow: string }[] = [];
  const base = new Date(`${monday}T00:00:00`);
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, label: iso.slice(5), dow: dows[i] });
  }
  return out;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface TherapistNow {
  id: string;
  name: string;
  code: string;
  shiftType: string;
  free: boolean;
  serviceName: string | null;
  since: string | null;
}
interface BedNow {
  id: string;
  name: string;
  free: boolean;
  occupant: string | null;
}
interface NowAvailability {
  bedsFree: number;
  bedsTotal: number;
  beds: BedNow[];
  therapistsFree: number;
  therapistsOnShift: number;
  therapists: TherapistNow[];
  nowMin: number;
}

// Live "right now" snapshot for the branch — always today, independent of the
// day/week being viewed. Counts service beds open this minute and rostered
// therapists who aren't mid-service. Shown above both the Station and Therapist
// views so the front desk can eyeball walk-in capacity at a glance.
async function computeNowAvailability(branchId: string): Promise<NowAvailability> {
  const supabase = createServiceClient();
  const day = todayISO();
  const nowMin = tsToMin(new Date().toISOString());

  const [bedsRes, shiftRes, itemsRes, resvRes, graceMin] = await Promise.all([
    supabase.from('resources').select('id, resource_name').eq('branch_id', branchId).eq('resource_type', 'massage_bed').eq('status', 'active').order('resource_name'),
    supabase.from('employee_shifts').select('employee_id, shift_type, shift_start, shift_end, employees:employee_id ( name, employee_code )').eq('branch_id', branchId).eq('shift_date', day).in('shift_type', TIMED),
    supabase
      .from('order_items')
      .select('therapist_id, resource_id, actual_start, actual_end, bed_released_at, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), order:orders!order_items_order_id_fkey ( branch_id, service_date, status )')
      .not('actual_start', 'is', null),
    supabase
      .from('reservations')
      .select('status, guest_name, desired_service_start, desired_service_end, service:service_items ( cleanup_after_minutes ), reservation_resources ( resource_id )')
      .eq('branch_id', branchId).eq('status', 'confirmed').is('deleted_at', null)
      .gte('desired_service_start', `${day}T00:00:00+08:00`).lte('desired_service_start', `${day}T23:59:59+08:00`),
    getReservationGraceMinutes(),
  ]);

  const bedIds = new Set((bedsRes.data ?? []).map((b) => b.id));
  const items = (itemsRes.data ?? []).filter((it) => { const o = one(it.order); return o && o.branch_id === branchId && o.service_date === day && o.status !== 'void' && it.actual_start; });

  // Beds busy this minute: an active service ([prep .. end (+cleanup)]) or a
  // confirmed, non-overdue pinned reservation whose window covers now.
  const busyBeds = new Set<string>();
  const busyBedInfo = new Map<string, string>(); // bed → what's on it (for the expandable list)
  for (const it of items) {
    if (!it.resource_id || !bedIds.has(it.resource_id)) continue;
    const prep = one(it.service)?.prep_before_minutes ?? 0;
    const cleanup = one(it.service)?.cleanup_after_minutes ?? 0;
    const s0 = tsToMin(it.actual_start!);
    const start = s0 - prep;
    let busy = false;
    if (it.actual_end) {
      const end = tsToMin(it.actual_end);
      const occEnd = it.bed_released_at ? end : end + cleanup; // released early frees the bed
      busy = nowMin >= start && nowMin < occEnd;
    } else {
      busy = nowMin >= start; // ongoing
    }
    if (busy) { busyBeds.add(it.resource_id); busyBedInfo.set(it.resource_id, one(it.service)?.name ?? 'In service'); }
  }
  for (const r of resvRes.data ?? []) {
    if (isReservationOverdue({ desiredStartIso: r.desired_service_start, graceMin })) continue;
    const cleanup = one(r.service)?.cleanup_after_minutes ?? 0;
    const start = tsToMin(r.desired_service_start);
    const occEnd = tsToMin(r.desired_service_end) + cleanup;
    if (nowMin >= start && nowMin < occEnd) for (const x of r.reservation_resources ?? []) if (bedIds.has(x.resource_id)) { busyBeds.add(x.resource_id); if (!busyBedInfo.has(x.resource_id)) busyBedInfo.set(x.resource_id, r.guest_name ?? 'Reserved'); }
  }
  const beds: BedNow[] = (bedsRes.data ?? [])
    .map((b) => ({ id: b.id, name: b.resource_name, free: !busyBeds.has(b.id), occupant: busyBedInfo.get(b.id) ?? null }))
    .sort((a, b) => Number(a.free) - Number(b.free) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Therapists rostered (timed shift covering now). On-duty = rostered (the
  // roster is the source of truth — no punch-clock); free = not mid-service.
  const onShift = new Set<string>();
  const meta = new Map<string, { name: string; code: string; shiftType: string }>();
  for (const s of shiftRes.data ?? []) {
    const e = one(s.employees);
    meta.set(s.employee_id, { name: e?.name ?? '—', code: e?.employee_code ?? '', shiftType: s.shift_type });
    const ss = timeToMin(s.shift_start), se = timeToMin(s.shift_end);
    if (ss != null && se != null && nowMin >= ss && nowMin < se) onShift.add(s.employee_id);
  }
  const busyTh = new Set<string>();
  const busyInfo = new Map<string, { serviceName: string; since: number }>();
  for (const it of items) {
    if (!it.therapist_id) continue;
    const s0 = tsToMin(it.actual_start!);
    const end = it.actual_end ? tsToMin(it.actual_end) : s0 + (it.duration_minutes ?? 60);
    if (nowMin >= s0 && nowMin < end) { busyTh.add(it.therapist_id); busyInfo.set(it.therapist_id, { serviceName: one(it.service)?.name ?? 'Service', since: s0 }); }
  }
  const therapists: TherapistNow[] = [...onShift]
    .map((id) => {
      const m = meta.get(id);
      const b = busyInfo.get(id);
      return { id, name: m?.name ?? '—', code: m?.code ?? '', shiftType: m?.shiftType ?? 'regular', free: !busyTh.has(id), serviceName: b?.serviceName ?? null, since: b ? hm(b.since) : null };
    })
    .sort((a, b) => Number(a.free) - Number(b.free) || a.code.localeCompare(b.code));

  return { bedsFree: Math.max(0, bedIds.size - busyBeds.size), bedsTotal: bedIds.size, beds, therapistsFree: therapists.filter((t) => t.free).length, therapistsOnShift: onShift.size, therapists, nowMin };
}

async function fetchData(branchParam?: string, weekParam?: string) {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const { data: branches } = await supabase
    .from('branches').select('id, code, name, therapist_share_group').eq('active', true).order('code');
  const list = (branches ?? []).filter((b) => allowed.has(b.id));
  const branchId = branchParam && list.some((b) => b.id === branchParam) ? branchParam : list[0]?.id;
  const monday = weekParam ?? thisMonday();
  const days = weekDays(monday);

  let employees: { id: string; employee_code: string; name: string; home_branch_id: string | null }[] = [];
  let shifts: ShiftRow[] = [];
  if (branchId) {
    // Roster the branch's own therapists + any from branches in the same sharing
    // group (cross-branch borrowing).
    const group = list.find((b) => b.id === branchId)?.therapist_share_group;
    const homeBranchIds = group ? list.filter((b) => b.therapist_share_group === group).map((b) => b.id) : [branchId];
    const [emp, sh] = await Promise.all([
      supabase.from('employees').select('id, employee_code, name, home_branch_id').in('home_branch_id', homeBranchIds).eq('status', 'active').order('employee_code'),
      supabase.from('employee_shifts')
        .select('employee_id, shift_date, shift_type, shift_start, shift_end, leave_type')
        .eq('branch_id', branchId)
        .gte('shift_date', days[0].date)
        .lte('shift_date', days[6].date),
    ]);
    employees = emp.data ?? [];
    shifts = (sh.data ?? []) as ShiftRow[];
  }

  return { branches: list, branchId, monday, days, employees, shifts };
}

export default async function ShiftSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; week?: string; view?: string; scale?: string; day?: string }>;
}) {
  const sp = await searchParams;
  // Station (live bed occupancy) is the default subject; Therapist + Dispatch are opt-in.
  const view: ShiftView = sp.view === 'employee' ? 'employee'
    : sp.view === 'dispatch' ? 'dispatch' : 'station';
  // The roster only plans working hours; beds are assigned dynamically when a
  // service starts. So the Station subject is a live, per-day occupancy snapshot
  // (sourced from actual orders) and is never a weekly pre-assignment grid.
  const scale: ShiftScale = view === 'station' ? 'day' : sp.scale === 'day' ? 'day' : 'week';
  const day = sp.day || todayISO();
  const { branches, branchId, monday, days, employees, shifts } = await fetchData(sp.branch, sp.week);
  // Editing the roster (set/clear/bulk shifts) is a manager task; everyone else
  // sees it read-only. Server actions enforce this too — this just hides the UI.
  const canManageRoster = isManager(await currentSession());
  // Station+day → the interactive 15-min board; Therapist+day → the read-only
  // timeline; Dispatch → list of external (hotel-dispatched) reservations.
  const stationBoard = view === 'station' && scale === 'day' && branchId ? await fetchStationBoard(branchId, day) : null;
  const dispatchRows = view === 'dispatch' && branchId ? await fetchDispatchData(branchId, day) : null;
  // The dialog data is needed by both Station (click-to-add) and Dispatch (edit).
  const boardDialog = (stationBoard || dispatchRows) ? await fetchBoardDialogData() : null;
  const dayData = view === 'employee' && scale === 'day' && branchId ? await fetchDayData('employee', branchId, day) : null;
  // Dispatch badge — show on the tab even when not on Dispatch view, so desk
  // doesn't need to switch tabs to spot external bookings.
  const dispatchCount = branchId
    ? (view === 'dispatch' ? (dispatchRows?.length ?? 0) : await fetchDispatchCount(branchId, day))
    : 0;
  // Live walk-in capacity snapshot — shown above both views, always for "now".
  const availability = branchId ? await computeNowAvailability(branchId) : null;

  const shiftAt = (empId: string, date: string): ShiftData | null => {
    const s = shifts.find((x) => x.employee_id === empId && x.shift_date === date);
    return s
      ? { shift_type: s.shift_type, shift_start: s.shift_start, shift_end: s.shift_end, leave_type: s.leave_type }
      : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Shift Schedule</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {scale === 'day'
              ? `${day} · ${
                  view === 'station' ? '15-min board · click a slot to add · drag a booking onto a bed'
                  : view === 'dispatch' ? 'external (hotel) dispatches · click a row to edit'
                  : 'hourly · therapist hours & services'
                }`
              : `Week of ${monday} · home-branch therapists${canManageRoster ? ' · click a cell to set a shift' : ' · view only'}`}
          </p>
        </div>
        {branchId && <ShiftControls branches={branches} branchId={branchId} weekStart={monday} day={day} view={view} scale={scale} dispatchCount={dispatchCount} />}
      </div>

      {/* Live walk-in capacity — open beds + free therapists this minute. Sits
          above both views, always reflecting "now" regardless of the day shown. */}
      {availability && (
        <div className="flex flex-wrap items-start gap-3">
          <BedsNowCard free={availability.bedsFree} total={availability.bedsTotal} beds={availability.beds} />
          <TherapistsNowCard free={availability.therapistsFree} onShift={availability.therapistsOnShift} therapists={availability.therapists} />
          <span className="self-center text-xs font-semibold text-muted-foreground">Live · as of {hm(availability.nowMin)} PHT</span>
        </div>
      )}

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : dispatchRows ? (
        <DispatchBoard day={day} rows={dispatchRows} dialog={boardDialog!} />
      ) : stationBoard ? (
        <ScheduleBoard
          branchId={branchId}
          day={day}
          beds={stationBoard.beds}
          blocks={stationBoard.blocks}
          windowStartMin={stationBoard.windowStartMin}
          windowEndMin={stationBoard.windowEndMin}
          bedCount={stationBoard.bedCount}
          shiftWindows={stationBoard.shiftWindows}
          nowMin={day === todayISO() ? tsToMin(new Date().toISOString()) : null}
          dialog={boardDialog!}
        />
      ) : scale === 'day' ? (
        <DayTimeline rows={dayData!.rows} windowStartMin={dayData!.windowStartMin} windowEndMin={dayData!.windowEndMin} subjectLabel="Therapist" nowMin={day === todayISO() ? tsToMin(new Date().toISOString()) : null} reservations={dayData!.reservations} />
      ) : employees.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          No active therapists for this branch (or its sharing group).
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {canManageRoster && (
            <div className="flex justify-end">
              <BulkShiftDialog
                branchId={branchId}
                employees={employees.map((e) => ({ id: e.id, name: e.name, code: e.employee_code, visiting: e.home_branch_id !== branchId }))}
                days={days}
              />
            </div>
          )}
        <Card className="p-0 overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {/* Top-left corner: frozen on both axes (above the header row and the name column). */}
                <th className="text-left font-bold text-sm p-3 w-48 sticky left-0 top-0 z-30 bg-card border-b border-border">Therapist</th>
                {days.map((d) => (
                  <th key={d.date} className="text-center font-bold text-xs p-2 min-w-[88px] sticky top-0 z-20 bg-card border-b border-border">
                    <div>{d.dow}</div>
                    <div className="font-medium text-muted-foreground tabular">{d.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="p-3 sticky left-0 z-10 bg-card">
                    <div className="font-semibold text-sm">
                      {e.name}
                      {e.home_branch_id !== branchId && (
                        <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                          from {branches.find((b) => b.id === e.home_branch_id)?.code ?? '?'}
                        </span>
                      )}
                    </div>
                    <div className="font-mono font-bold text-xs text-muted-foreground">{e.employee_code}</div>
                  </td>
                  {days.map((d) => (
                    <td key={d.date} className="p-1 align-middle">
                      <ShiftCell
                        employeeId={e.id}
                        employeeName={e.name}
                        branchId={branchId}
                        date={d.date}
                        shift={shiftAt(e.id, d.date)}
                        visiting={e.home_branch_id !== branchId}
                        readOnly={!canManageRoster}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        </div>
      )}

      {/* The Station board carries its own legend; this one is for the shift views. */}
      {!stationBoard && (
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-primary/15" /> Regular</span>
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-amber-500/15" /> Cross-branch</span>
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-blue-500/15" /> On-call</span>
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-muted" /> Off</span>
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-destructive/15" /> Leave</span>
          {scale === 'day' && (
            <>
              <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-amber-500/70 bg-amber-500/15" /> Reservation — pending</span>
              <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-violet-500/70 bg-violet-500/20" /> Reservation — confirmed</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
