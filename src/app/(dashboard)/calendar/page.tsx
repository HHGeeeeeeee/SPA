import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { type ShiftData } from '@/components/shift-schedule/shift-cell';
import { DayTimeline, type DayRow } from '@/components/shift-schedule/day-timeline';
import { ScheduleBoard, type BoardBed, type BoardBlock, type BlockVariant, type BoardDialogData, type BoardStaffShift } from '@/components/shift-schedule/schedule-board';
import { DispatchBoard } from '@/components/shift-schedule/dispatch-board';
import { StaffWeekGrid } from '@/components/shift-schedule/staff-week-grid';
import { BulkShiftDialog } from '@/components/shift-schedule/bulk-shift-dialog';
import type { ReservationItem } from '@/components/reservations/new-reservation-dialog';
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
// 'YYYY-MM-DD' + 1 calendar day (UTC math, tz-agnostic for the date string).
function dayPlusOne(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function tsToMin(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

// Day (hourly) view for either subject. Therapist rows show each rostered
// therapist's working window + their actual service blocks; Station rows show
// each bed's occupancy from actual service times.
async function fetchDayData(subject: ShiftView, branchId: string, day: string): Promise<{ rows: DayRow[]; windowStartMin: number; windowEndMin: number }> {
  const supabase = createServiceClient();
  // Board window = this branch's business hours (see fetchStationBoard). Past
  // midnight (close <= open) extends the window beyond 1440 and shifts the
  // after-midnight slots by +1440 via place().
  const { data: brHours } = await supabase.from('branches').select('open_time, close_time').eq('id', branchId).maybeSingle();
  const openMin = timeToMin(brHours?.open_time ?? '10:00') ?? 600;
  const closeMin = timeToMin(brHours?.close_time ?? '02:00') ?? 120;
  const crossesMidnight = closeMin <= openMin;
  const windowStartMin = openMin;
  const windowEndMin = crossesMidnight ? closeMin + 1440 : closeMin;
  const place = (clockMin: number) => (clockMin < openMin ? clockMin + 1440 : clockMin);
  const openHH = (brHours?.open_time ?? '10:00').slice(0, 5);
  const closeHH = (brHours?.close_time ?? '02:00').slice(0, 5);
  const rangeStart = `${day}T${openHH}:00+08:00`;
  const rangeEnd = `${crossesMidnight ? dayPlusOne(day) : day}T${closeHH}:00+08:00`;
  const { data: itemData } = await supabase
    .from('order_items')
    .select('id, therapist_id, resource_id, actual_start, actual_end, bed_released_at, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), therapist:employees!order_items_therapist_id_fkey ( name, employee_code ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date, status )')
    .not('actual_start', 'is', null);
  const dayItems = (itemData ?? []).filter((it) => {
    const ord = one(it.order);
    return ord && ord.branch_id === branchId && ord.service_date === day && ord.status !== 'void' && it.actual_start;
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
      const s0 = place(tsToMin(it.actual_start!));
      const startMin = Math.max(0, s0 - prepMin);
      const endMin = it.actual_end ? place(tsToMin(it.actual_end)) : Math.min(windowEndMin, s0 + (it.duration_minutes ?? 60));
      // A finished line still holds the bed for cleanup_after_minutes (unless
      // released early). Only show it while the buffer hasn't elapsed.
      const cleanupMin = one(it.service)?.cleanup_after_minutes ?? 0;
      let cleanupEndMin: number | undefined;
      let itemId: string | undefined;
      if (it.actual_end && cleanupMin > 0 && !it.bed_released_at
          && Date.parse(it.actual_end) + cleanupMin * 60000 > nowMs) {
        cleanupEndMin = Math.min(windowEndMin, endMin + cleanupMin);
        itemId = it.id;
      }
      // Station rows: who is on the bed (line 1) + which service (line 2).
      const svcName = one(it.service)?.name ?? 'Service';
      const thName = one(it.therapist)?.name ?? null;
      const arr = byStation.get(it.resource_id) ?? [];
      arr.push({ line1: thName ?? svcName, line2: thName ? svcName : undefined, startMin, endMin, ongoing: !it.actual_end, cleanupEndMin, itemId, orderId: one(it.order)?.id });
      byStation.set(it.resource_id, arr);
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
      const startMin = place(tsToMin(it.actual_start!));
      // Therapists carry no prep/cleanup buffer (that's the bed's turnover, not
      // the person's) — their block is the pure service window.
      const endMin = it.actual_end ? place(tsToMin(it.actual_end)) : Math.min(windowEndMin, startMin + (it.duration_minutes ?? 60));
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
        shiftStartMin: (() => { const m = timeToMin(s.shift_start); return m == null ? null : place(m); })(),
        shiftEndMin: (() => { const m = timeToMin(s.shift_end); return m == null ? null : place(m); })(),
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
  // Reservations retired — the booking lane is now order_items (the Station
  // board's left rail); the Therapist timeline shows no separate reservation lane.
  return { rows, windowStartMin, windowEndMin };
}

// Interactive Station board (15-min): beds as rows, with every scheduled /
// in-service / done order item on its bed, pinned reservations as bed blocks,
// and unplaced reservations in the "To place" lane (drag onto a bed).
async function fetchStationBoard(branchId: string, day: string): Promise<{ beds: BoardBed[]; blocks: BoardBlock[]; windowStartMin: number; windowEndMin: number; bedCount: number; staffShifts: BoardStaffShift[] }> {
  const supabase = createServiceClient();
  // Board window = this branch's business hours. A close at/before open means it
  // trades past midnight, so the window extends past 1440 and the bookings in
  // 00:00..close (next clock day, same business day) are shifted by +1440.
  const { data: brHours } = await supabase.from('branches').select('open_time, close_time').eq('id', branchId).maybeSingle();
  const openMin = timeToMin(brHours?.open_time ?? '10:00') ?? 600;
  const closeMin = timeToMin(brHours?.close_time ?? '02:00') ?? 120;
  const crossesMidnight = closeMin <= openMin;
  const windowStartMin = openMin;
  const windowEndMin = crossesMidnight ? closeMin + 1440 : closeMin;
  const place = (clockMin: number) => (clockMin < openMin ? clockMin + 1440 : clockMin);
  const openHH = (brHours?.open_time ?? '10:00').slice(0, 5);
  const closeHH = (brHours?.close_time ?? '02:00').slice(0, 5);
  const rangeStart = `${day}T${openHH}:00+08:00`;
  const rangeEnd = `${crossesMidnight ? dayPlusOne(day) : day}T${closeHH}:00+08:00`;
  const [bedsRes, itemsRes, shiftRes, unassignedRes] = await Promise.all([
    supabase.from('resources').select('id, resource_name, resource_type').eq('branch_id', branchId).eq('status', 'active').order('resource_name'),
    supabase
      .from('order_items')
      .select('id, status, resource_id, therapist_id, actual_start, actual_end, scheduled_start, service_start, slot_start, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date, status, order_customers ( id ) )')
      .in('status', ['scheduled', 'in_service', 'service_completed', 'interrupted'])
      .not('resource_id', 'is', null),
    // Pull the full roster (with employee identity + position) instead of bare
    // time windows; the schedule board now uses this to power the per-position
    // hover popup ("who's free at 14:30?") on top of the original on-shift count.
    supabase
      .from('employee_shifts')
      .select('employee_id, shift_start, shift_end, employees:employee_id ( name, employee_code, position:positions ( code ) )')
      .eq('branch_id', branchId).eq('shift_date', day).in('shift_type', ['regular', 'cross_branch', 'on_call']),
    // Unassigned lines (a booking with no bed yet) — they ride the unallocated
    // rail. No resource filter (they have none); branch/day filtered in the loop.
    supabase
      .from('order_items')
      .select('id, status, therapist_id, scheduled_start, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), category:service_categories ( name ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date, status )')
      .eq('status', 'unassigned'),
  ]);

  const beds: BoardBed[] = (bedsRes.data ?? []).map((b) => ({ id: b.id, name: b.resource_name, type: b.resource_type }));
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
      startMin = place(tsToMin(sIso)); endMin = startMin + dur; variant = 'scheduled'; draggable = true;
    } else {
      if (!it.actual_start) continue;
      startMin = place(tsToMin(it.actual_start));
      endMin = it.actual_end ? place(tsToMin(it.actual_end)) : startMin + dur;
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
      therapistId: it.therapist_id ?? null,
    });
    mins.push(startMin, endMin);
  }

  // Unassigned lines (booking with no bed yet) → the unallocated rail. Timed ones
  // (scheduled_start set) get an axis position + feed the per-hour pending band;
  // untimed ones sit in the rail's "no time yet" section.
  for (const it of unassignedRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || ord.branch_id !== branchId || ord.service_date !== day || ord.status === 'void') continue;
    const dur = it.duration_minutes ?? 60;
    const timed = !!it.scheduled_start;
    const startMin = timed ? place(tsToMin(it.scheduled_start!)) : windowStartMin;
    const endMin = startMin + dur;
    blocks.push({
      key: `oi:${it.id}`, kind: 'order', refId: it.id, bedId: null,
      guest: one(it.guest)?.customer_name ?? undefined, pax: 1,
      line1: one(it.service)?.name ?? one(it.category)?.name ?? 'Service',
      line2: one(it.therapist)?.name ?? undefined,
      startMin, endMin, durationMin: dur,
      prepMin: one(it.service)?.prep_before_minutes ?? 0,
      cleanupMin: one(it.service)?.cleanup_after_minutes ?? 0,
      variant: 'scheduled', draggable: true, orderId: ord.id,
      therapistId: it.therapist_id ?? null,
      untimed: !timed,
    });
    if (timed) mins.push(startMin, endMin);
  }


  // Service-providing positions only — receptionists / managers are on shift
  // but never relevant for "who's free to take a booking".
  const isServicePosition = (code: string | null): boolean =>
    !!code && (code.startsWith('MASSAGE_') || code.startsWith('HAIR_') || code.startsWith('NAIL_'));
  const staffShifts: BoardStaffShift[] = (shiftRes.data ?? [])
    .map((s) => {
      const e = one(s.employees);
      const positionCode = e ? one(e.position)?.code ?? null : null;
      return {
        id: s.employee_id,
        name: e?.name ?? '—',
        code: e?.employee_code ?? '',
        positionCode,
        startMin: (() => { const m = timeToMin(s.shift_start); return m == null ? null : place(m); })(),
        endMin: (() => { const m = timeToMin(s.shift_end); return m == null ? null : place(m); })(),
      };
    })
    .filter((w): w is BoardStaffShift => w.startMin != null && w.endMin != null && isServicePosition(w.positionCode));
  return { beds, blocks, windowStartMin, windowEndMin, bedCount: beds.length, staffShifts };
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
  // Dispatch (external/hotel bookings) is being rebuilt on orders — an external
  // booking is an order with service_location_type='external_hotel'. createBooking
  // does not capture external_room_no yet, so this is empty until that is wired.
  void branchId; void day;
  return [];
}

// Quick count for the Dispatch tab badge — cheaper than fetchDispatchData when
// the user isn't on the Dispatch tab.
async function fetchDispatchCount(branchId: string, day: string): Promise<number> {
  void branchId; void day;
  return 0;
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

async function fetchData(branchParam?: string, weekParam?: string) {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const { data: branches } = await supabase
    .from('branches').select('id, code, name, therapist_share_group').eq('active', true).order('code');
  const list = (branches ?? []).filter((b) => allowed.has(b.id));
  const branchId = branchParam && list.some((b) => b.id === branchParam) ? branchParam : list[0]?.id;
  const monday = weekParam ?? thisMonday();
  const days = weekDays(monday);

  let employees: { id: string; employee_code: string; name: string; home_branch_id: string | null; position_code: string | null }[] = [];
  let shifts: ShiftRow[] = [];
  if (branchId) {
    // Roster the branch's own therapists + any from branches in the same sharing
    // group (cross-branch borrowing). Position joined so the week grid can
    // group rows by Massage / Hair / Nail like the live cards do.
    const group = list.find((b) => b.id === branchId)?.therapist_share_group;
    const homeBranchIds = group ? list.filter((b) => b.therapist_share_group === group).map((b) => b.id) : [branchId];
    const [emp, sh] = await Promise.all([
      supabase.from('employees').select('id, employee_code, name, home_branch_id, position:positions ( code )').in('home_branch_id', homeBranchIds).eq('status', 'active').order('employee_code'),
      supabase.from('employee_shifts')
        .select('employee_id, shift_date, shift_type, shift_start, shift_end, leave_type')
        .eq('branch_id', branchId)
        .gte('shift_date', days[0].date)
        .lte('shift_date', days[6].date),
    ]);
    employees = (emp.data ?? []).map((e) => ({
      id: e.id, employee_code: e.employee_code, name: e.name, home_branch_id: e.home_branch_id,
      position_code: one(e.position)?.code ?? null,
    }));
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
          <h2 className="text-3xl font-bold tracking-tight">Calendar</h2>
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
          staffShifts={stationBoard.staffShifts}
          nowMin={day === todayISO() ? tsToMin(new Date().toISOString()) : null}
          dialog={boardDialog!}
        />
      ) : scale === 'day' ? (
        <DayTimeline rows={dayData!.rows} windowStartMin={dayData!.windowStartMin} windowEndMin={dayData!.windowEndMin} subjectLabel="Therapist" nowMin={day === todayISO() ? tsToMin(new Date().toISOString()) : null} />
      ) : employees.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          No active staff for this branch (or its sharing group).
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
          {/* Pre-flatten the (employee, date) → ShiftData map server-side so
              the client component can do O(1) lookups while rendering. */}
          {(() => {
            const lookup: Record<string, ShiftData | null> = {};
            for (const e of employees) {
              for (const d of days) {
                lookup[`${e.id}:${d.date}`] = shiftAt(e.id, d.date);
              }
            }
            return (
              <StaffWeekGrid
                branchId={branchId}
                branches={branches}
                employees={employees}
                days={days}
                shiftLookup={lookup}
                canManageRoster={canManageRoster}
              />
            );
          })()}
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
