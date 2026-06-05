import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { ScheduleBoard, type BoardBed, type BoardBlock, type BlockVariant, type BoardDialogData, type BoardStaffShift } from '@/components/shift-schedule/schedule-board';
import { getAllowedBranchIds } from '@/lib/branch-access';

export const dynamic = 'force-dynamic';

type CalendarView = 'station' | 'people';

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
  // Multi-branch: show the selected branch + the rest of its therapist-sharing
  // group, so cross-branch stations + bookings sit on one board (grouped by
  // Branch). Falls back to just the selected branch when it isn't in a group.
  const { data: brRow } = await supabase.from('branches').select('therapist_share_group').eq('id', branchId).maybeSingle();
  const group = brRow?.therapist_share_group ?? null;
  const { data: grpBranches } = group
    ? await supabase.from('branches').select('id, code, name').eq('therapist_share_group', group).eq('active', true).order('code')
    : await supabase.from('branches').select('id, code, name').eq('id', branchId);
  const allowedBranches = await getAllowedBranchIds();
  const branchList = (grpBranches ?? []).filter((b) => allowedBranches.has(b.id));
  if (branchList.length === 0) branchList.push({ id: branchId, code: '—', name: '' });
  const branchIds = new Set(branchList.map((b) => b.id));
  const branchCodeById = new Map(branchList.map((b) => [b.id, b.code]));
  const [bedsRes, itemsRes, shiftRes, unassignedRes] = await Promise.all([
    supabase.from('resources').select('id, resource_name, resource_type, location_zone, branch_id').in('branch_id', [...branchIds]).eq('status', 'active').order('resource_name'),
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

  const beds: BoardBed[] = (bedsRes.data ?? []).map((b) => ({ id: b.id, name: b.resource_name, type: b.resource_type, branch: branchCodeById.get(b.branch_id) ?? '—', zone: b.location_zone ?? null }));
  const blocks: BoardBlock[] = [];
  const mins: number[] = [];

  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || !branchIds.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void' || !it.resource_id) continue;
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
    if (!ord || !branchIds.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void') continue;
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

// Per-person board (15-min): therapist rows, each painted with its on-shift
// band; a booking assigned to a therapist (therapist_id) lands on their row,
// while bookings with no therapist yet ride the left "Unallocated" rail. Drag a
// rail card onto a person to pre-assign them. Mirrors fetchStationBoard but keyed
// on therapist_id instead of resource_id.
async function fetchPeopleBoard(branchId: string, day: string): Promise<{ beds: BoardBed[]; blocks: BoardBlock[]; windowStartMin: number; windowEndMin: number; bedCount: number; staffShifts: BoardStaffShift[] }> {
  const supabase = createServiceClient();
  const { data: brHours } = await supabase.from('branches').select('open_time, close_time').eq('id', branchId).maybeSingle();
  const openMin = timeToMin(brHours?.open_time ?? '10:00') ?? 600;
  const closeMin = timeToMin(brHours?.close_time ?? '02:00') ?? 120;
  const crossesMidnight = closeMin <= openMin;
  const windowStartMin = openMin;
  const windowEndMin = crossesMidnight ? closeMin + 1440 : closeMin;
  const place = (clockMin: number) => (clockMin < openMin ? clockMin + 1440 : clockMin);
  const isServicePosition = (code: string | null): boolean =>
    !!code && (code.startsWith('MASSAGE_') || code.startsWith('HAIR_') || code.startsWith('NAIL_'));

  const [shiftRes, itemsRes] = await Promise.all([
    supabase
      .from('employee_shifts')
      .select('employee_id, shift_start, shift_end, employees:employee_id ( name, employee_code, position:positions ( code ) )')
      .eq('branch_id', branchId).eq('shift_date', day).in('shift_type', ['regular', 'cross_branch', 'on_call']),
    supabase
      .from('order_items')
      .select('id, status, therapist_id, scheduled_start, service_start, slot_start, actual_start, actual_end, duration_minutes, external_room_no, service:service_items ( name ), category:service_categories ( name ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date, status, service_location_type )')
      .in('status', ['scheduled', 'in_service', 'service_completed', 'interrupted', 'unassigned']),
  ]);

  // Rows = on-shift service therapists today, carrying their shift window so the
  // row paints a faint "on shift" band.
  const rowsById = new Map<string, BoardBed>();
  const staffShifts: BoardStaffShift[] = [];
  for (const s of shiftRes.data ?? []) {
    const e = one(s.employees);
    const positionCode = e ? one(e.position)?.code ?? null : null;
    if (!isServicePosition(positionCode)) continue;
    const ss = timeToMin(s.shift_start); const se = timeToMin(s.shift_end);
    const startMin = ss == null ? null : place(ss);
    const endMin = se == null ? null : place(se);
    rowsById.set(s.employee_id, { id: s.employee_id, name: e?.name ?? '—', type: positionCode ?? '_other', shiftStartMin: startMin, shiftEndMin: endMin });
    if (startMin != null && endMin != null) {
      staffShifts.push({ id: s.employee_id, name: e?.name ?? '—', code: e?.employee_code ?? '', positionCode, startMin, endMin });
    }
  }

  const blocks: BoardBlock[] = [];
  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || ord.branch_id !== branchId || ord.service_date !== day || ord.status === 'void') continue;
    const dur = it.duration_minutes ?? 60;
    let startMin: number;
    let endMin: number;
    let variant: BlockVariant;
    let untimed = false;
    if (it.status === 'in_service' || it.status === 'service_completed' || it.status === 'interrupted') {
      if (!it.actual_start) continue;
      startMin = place(tsToMin(it.actual_start));
      endMin = it.actual_end ? place(tsToMin(it.actual_end)) : startMin + dur;
      variant = it.status === 'in_service' ? 'in_service' : 'completed';
    } else {
      const sIso = it.scheduled_start ?? it.service_start ?? it.slot_start;
      if (sIso) { startMin = place(tsToMin(sIso)); } else { startMin = windowStartMin; untimed = true; }
      endMin = startMin + dur;
      variant = 'scheduled';
    }
    const therapistId = it.therapist_id ?? null;
    // A booking whose therapist isn't on shift today still needs a row to show on.
    if (therapistId && !rowsById.has(therapistId)) {
      rowsById.set(therapistId, { id: therapistId, name: one(it.therapist)?.name ?? 'Therapist', type: '_other' });
    }
    blocks.push({
      key: `oi:${it.id}`, kind: 'order', refId: it.id, bedId: therapistId,
      guest: one(it.guest)?.customer_name ?? undefined, pax: 1,
      line1: one(it.service)?.name ?? one(it.category)?.name ?? 'Service',
      // Dispatch (external hotel) booking — no in-house station; flag it + show
      // the room so the People board reads it as off-site, not a bedless gap.
      line2: ord.service_location_type === 'external_hotel'
        ? `Dispatch${it.external_room_no ? ` · Rm ${it.external_room_no}` : ''}`
        : undefined,
      startMin, endMin, durationMin: dur, prepMin: 0, cleanupMin: 0,
      variant, draggable: it.status === 'unassigned' || it.status === 'scheduled',
      orderId: ord.id, therapistId, untimed,
    });
  }

  const beds = [...rowsById.values()];
  return { beds, blocks, windowStartMin, windowEndMin, bedCount: beds.length, staffShifts };
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

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchBranches(branchParam?: string): Promise<{ branches: { id: string; code: string; name: string }[]; branchId: string | undefined }> {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const { data } = await supabase
    .from('branches').select('id, code, name').eq('active', true).order('code');
  const list = (data ?? []).filter((b) => allowed.has(b.id));
  const branchId = branchParam && list.some((b) => b.id === branchParam) ? branchParam : list[0]?.id;
  return { branches: list, branchId };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; view?: string; day?: string }>;
}) {
  const sp = await searchParams;
  // Station (live bed board) is the default; People is the same board keyed on
  // therapists (rows = staff, shift hours as a faint band).
  const view: CalendarView = sp.view === 'people' ? 'people' : 'station';
  const day = sp.day || todayISO();
  const { branches, branchId } = await fetchBranches(sp.branch);

  const stationBoard = view === 'station' && branchId ? await fetchStationBoard(branchId, day) : null;
  const peopleBoard = view === 'people' && branchId ? await fetchPeopleBoard(branchId, day) : null;
  // The click-to-add dialog data is shared by both boards (People's click-to-add
  // is gated off for now, but the prop is required).
  const boardDialog = (stationBoard || peopleBoard) ? await fetchBoardDialogData() : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Calendar</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {day} · {view === 'station'
              ? '15-min board · click a slot to add · drag a booking onto a bed'
              : 'by therapist · drag a booking onto a person to assign'}
          </p>
        </div>
        {branchId && <ShiftControls branches={branches} branchId={branchId} day={day} view={view} />}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
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
      ) : peopleBoard ? (
        <ScheduleBoard
          branchId={branchId}
          day={day}
          beds={peopleBoard.beds}
          blocks={peopleBoard.blocks}
          windowStartMin={peopleBoard.windowStartMin}
          windowEndMin={peopleBoard.windowEndMin}
          bedCount={peopleBoard.bedCount}
          staffShifts={peopleBoard.staffShifts}
          nowMin={day === todayISO() ? tsToMin(new Date().toISOString()) : null}
          dialog={boardDialog!}
          axis="person"
          subjectLabel="Therapist"
        />
      ) : (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Pick Station or People to view the board.
        </Card>
      )}
    </div>
  );
}