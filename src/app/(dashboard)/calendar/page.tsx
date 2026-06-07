import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { ScheduleBoard, type BoardBed, type BoardBlock, type BlockVariant, type BoardDialogData, type BoardStaffShift, type AssignBed, type BoardOccupancy } from '@/components/shift-schedule/schedule-board';
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
// Service names bake the duration in as "… 90min"; show it compactly as "(90)".
const fmtSvc = (name: string | null | undefined): string => (name ?? 'Service').replace(/\s*(\d+)\s*min\b/i, ' ($1)');

async function fetchStationBoard(branchIds: string[], day: string): Promise<{ beds: BoardBed[]; blocks: BoardBlock[]; windowStartMin: number; windowEndMin: number; bedCount: number; staffShifts: BoardStaffShift[]; occupancy: BoardOccupancy }> {
  const supabase = createServiceClient();
  const branchId = branchIds[0];
  const brSet = new Set(branchIds);
  const nowMin = day === todayISO() ? tsToMin(new Date().toISOString()) : null;
  // Board window = this branch's business hours. A close at/before open means it
  // trades past midnight, so the window extends past 1440 and the bookings in
  // 00:00..close (next clock day, same business day) are shifted by +1440.
  const { data: brHoursAll } = await supabase.from('branches').select('id, open_time, close_time, therapist_share_group').in('id', branchIds);
  const brHours = (brHoursAll ?? []).find((b) => b.id === branchId) ?? null;
  // Window spans ALL selected branches' hours (union): earliest open to latest
  // close, so an earlier-opening branch's morning shifts don't wrap to next day.
  const openMin = Math.min(...((brHoursAll ?? []).map((b) => timeToMin(b.open_time ?? '10:00') ?? 600).concat(600)));
  const closeMin = timeToMin(brHours?.close_time ?? '02:00') ?? 120;
  const crossesMidnight = closeMin <= openMin;
  const windowStartMin = openMin;
  const place = (clockMin: number) => (clockMin < openMin ? clockMin + 1440 : clockMin);
  const windowEndMin = Math.max(...((brHoursAll ?? []).map((b) => place(timeToMin(b.close_time ?? '02:00') ?? 120)).concat(120)));
  const openHH = (brHours?.open_time ?? '10:00').slice(0, 5);
  const closeHH = (brHours?.close_time ?? '02:00').slice(0, 5);
  const rangeStart = `${day}T${openHH}:00+08:00`;
  const rangeEnd = `${crossesMidnight ? dayPlusOne(day) : day}T${closeHH}:00+08:00`;
  // Multi-branch: show the selected branch + the rest of its therapist-sharing
  // group, so cross-branch stations + bookings sit on one board (grouped by
  // Branch). Falls back to just the selected branch when it isn't in a group.
  // Map ALL branch codes (not just the filtered ones): a booking can sit on a
  // cross-branch station whose branch is outside the current filter, and its
  // label must still resolve to that station's real branch.
  const { data: brCodes } = await supabase.from('branches').select('id, code, therapist_share_group');
  const branchCodeById = new Map((brCodes ?? []).map((b) => [b.id, b.code]));
  // Therapist capacity pools the whole share group (each branch sees the full pool).
  const grpBranchIds = shareGroupBranchIds(brCodes ?? [], branchIds);
  const [bedsRes, itemsRes, shiftRes, unassignedRes] = await Promise.all([
    supabase.from('resources').select('id, resource_name, resource_type, location_zone, branch_id').in('branch_id', branchIds).eq('status', 'active').order('resource_name'),
    supabase
      .from('order_items')
      .select('id, status, resource_id, therapist_id, actual_start, actual_end, scheduled_start, service_start, slot_start, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name, seq_no ), order:orders!order_items_order_id_fkey ( id, order_no, branch_id, service_date, status, total_cents, paid_cents, order_customers ( id ) )')
      .in('status', ['draft', 'in_service', 'service_completed', 'interrupted'])
      .not('resource_id', 'is', null),
    // Pull the full roster (with employee identity + position) instead of bare
    // time windows; the schedule board now uses this to power the per-position
    // hover popup ("who's free at 14:30?") on top of the original on-shift count.
    supabase
      .from('employee_shifts')
      .select('employee_id, shift_start, shift_end, employees:employee_id ( name, employee_code, position:positions ( code ), home_branch:branches!employees_home_branch_id_fkey ( code ) )')
      .in('branch_id', grpBranchIds).eq('shift_date', day).in('shift_type', ['regular', 'cross_branch', 'on_call']),
    // Unassigned lines (a booking with no bed yet) — they ride the unallocated
    // rail. No resource filter (they have none); branch/day filtered in the loop.
    supabase
      .from('order_items')
      .select('id, status, therapist_id, scheduled_start, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), category:service_categories ( name ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name, seq_no ), order:orders!order_items_order_id_fkey ( id, order_no, branch_id, service_date, status, service_location_type, total_cents, paid_cents, order_customers ( id ) )')
      .eq('status', 'draft').is('resource_id', null),
  ]);

  const beds: BoardBed[] = (bedsRes.data ?? []).map((b) => ({ id: b.id, name: b.resource_name, type: b.resource_type, branch: branchCodeById.get(b.branch_id) ?? '—', zone: b.location_zone ?? null }));
  const blocks: BoardBlock[] = [];
  const mins: number[] = [];

  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || !brSet.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void' || !it.resource_id) continue;
    const dur = it.duration_minutes ?? 60;
    let startMin: number;
    let endMin: number;
    let variant: BlockVariant;
    let draggable = false;
    if (it.status === 'draft') {
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
      orderNo: ord.order_no ?? undefined, guestSeq: one(it.guest)?.seq_no ?? null,
      guestTotal: (ord as unknown as { order_customers?: { id: string }[] }).order_customers?.length ?? null,
      line1: fmtSvc(one(it.service)?.name), line2: one(it.therapist)?.name ?? undefined,
      startMin, endMin, durationMin: dur,
      prepMin: one(it.service)?.prep_before_minutes ?? 0,
      cleanupMin: one(it.service)?.cleanup_after_minutes ?? 0,
      variant, draggable, orderId: ord.id,
      owing: (ord.total_cents ?? 0) - (ord.paid_cents ?? 0) !== 0,
      balanceCents: (ord.total_cents ?? 0) - (ord.paid_cents ?? 0),
      listPriceCents: it.list_price_cents ?? null,
      discountCents: it.discount_amount_cents ?? null,
      finalAmountCents: it.final_amount_cents ?? null,
      therapistId: it.therapist_id ?? null,
      // On a bed already; red only when it still lacks a therapist.
      needsAssignment: it.status === 'draft' && !it.therapist_id,
    });
    mins.push(startMin, endMin);
  }

  // Unassigned lines (booking with no bed yet) → the unallocated rail. Timed ones
  // (scheduled_start set) get an axis position + feed the per-hour pending band;
  // untimed ones sit in the rail's "no time yet" section.
  for (const it of unassignedRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || !brSet.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void') continue;
    const dur = it.duration_minutes ?? 60;
    const timed = !!it.scheduled_start;
    const startMin = timed ? place(tsToMin(it.scheduled_start!)) : windowStartMin;
    const endMin = startMin + dur;
    blocks.push({
      key: `oi:${it.id}`, kind: 'order', refId: it.id, bedId: null,
      guest: one(it.guest)?.customer_name ?? undefined, pax: 1,
      orderNo: ord.order_no ?? undefined, guestSeq: one(it.guest)?.seq_no ?? null,
      guestTotal: (ord as unknown as { order_customers?: { id: string }[] }).order_customers?.length ?? null,
      line1: fmtSvc(one(it.service)?.name ?? one(it.category)?.name),
      line2: one(it.therapist)?.name ?? undefined,
      startMin, endMin, durationMin: dur,
      prepMin: one(it.service)?.prep_before_minutes ?? 0,
      cleanupMin: one(it.service)?.cleanup_after_minutes ?? 0,
      variant: 'scheduled', draggable: true, orderId: ord.id,
      owing: (ord.total_cents ?? 0) - (ord.paid_cents ?? 0) !== 0,
      balanceCents: (ord.total_cents ?? 0) - (ord.paid_cents ?? 0),
      therapistId: it.therapist_id ?? null,
      untimed: !timed,
      // Bedless rail card: red unless it's a dispatch (never needs a bed) that
      // already has a therapist.
      needsAssignment: !it.therapist_id || ord.service_location_type !== 'external_hotel',
    });
    if (timed) mins.push(startMin, endMin);
  }


  // Service-providing positions only — receptionists / managers are on shift
  // but never relevant for "who's free to take a booking".
  const isServicePosition = (code: string | null): boolean =>
    !!code && (code.startsWith('MASSAGE_') || code.startsWith('HAIR_') || code.startsWith('NAIL_'));
  const staffSeen = new Set<string>();
  const staffShifts: BoardStaffShift[] = (shiftRes.data ?? [])
    .map((s) => {
      const e = one(s.employees);
      const positionCode = e ? one(e.position)?.code ?? null : null;
      const homeBranch = e ? one(e.home_branch)?.code ?? undefined : undefined;
      return {
        id: s.employee_id,
        name: e?.name ?? '—',
        code: e?.employee_code ?? '',
        positionCode,
        startMin: (() => { const m = timeToMin(s.shift_start); return m == null ? null : place(m); })(),
        endMin: (() => { const m = timeToMin(s.shift_end); return m == null ? null : place(m); })(),
        ...(homeBranch ? { branch: homeBranch } : {}),
      };
    })
    // A cross-branch therapist can carry two shift rows (home + loaned); the
    // staffSeen guard keeps the first so each shows once.
    .filter((w): w is BoardStaffShift =>
      w.startMin != null && w.endMin != null && isServicePosition(w.positionCode)
      && !staffSeen.has(w.id) && (staffSeen.add(w.id), true));

  // ── Occupancy / utilization ──────────────────────────────────────────────
  // Therapist capacity = the service therapists actually rostered AT these
  // branches today (staffShifts already filters branch + service position, so it
  // includes cross-branch loaned-in and excludes loaned-out). Bed capacity =
  // active station count. Demand windows come from the same items above.
  const placedNow = nowMin != null ? place(nowMin) : null;
  const bedBusy: OccWin[] = [];
  const therBusy: OccWin[] = [];
  const actual: OccWin[] = [];
  const collect = (rows: typeof itemsRes.data, allowBedless: boolean) => {
    for (const it of rows ?? []) {
      const ord = one(it.order);
      if (!ord || !brSet.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void') continue;
      const r = it as { status: string; resource_id?: string | null; therapist_id?: string | null; scheduled_start?: string | null; service_start?: string | null; slot_start?: string | null; actual_start?: string | null; actual_end?: string | null; duration_minutes?: number | null };
      const dur = r.duration_minutes ?? 60;
      let s: number;
      let occEnd: number;
      if (r.status === 'draft') {
        const sIso = r.scheduled_start ?? r.service_start ?? r.slot_start;
        if (!sIso) continue; // untimed → can't attribute to an hour
        s = place(tsToMin(sIso)); occEnd = s + dur;
      } else {
        if (!r.actual_start) continue;
        s = place(tsToMin(r.actual_start));
        occEnd = r.actual_end ? place(tsToMin(r.actual_end)) : s + dur;
        const actEnd = r.actual_end ? place(tsToMin(r.actual_end)) : (placedNow != null ? Math.max(s, placedNow) : s + dur);
        actual.push({ s, e: actEnd });
      }
      if (r.resource_id) bedBusy.push({ s, e: occEnd });
      else if (!allowBedless) continue;
      if (r.therapist_id) therBusy.push({ s, e: occEnd });
    }
  };
  collect(itemsRes.data, true);
  collect(unassignedRes.data as typeof itemsRes.data, true);
  const sg = shareGroupComputable((brHoursAll ?? []).map((b) => (b as { therapist_share_group?: string | null }).therapist_share_group ?? null));
  const occupancy = buildOccupancy({
    computable: sg.ok,
    note: sg.note,
    windowStartMin,
    windowEndMin,
    stationCount: beds.length,
    shifts: staffShifts.map((w) => ({ s: w.startMin, e: w.endMin })),
    bedBusy,
    therBusy,
    actual,
  });

  return { beds, blocks, windowStartMin, windowEndMin, bedCount: beds.length, staffShifts, occupancy };
}

// Per-person board (15-min): therapist rows, each painted with its on-shift
// band; a booking assigned to a therapist (therapist_id) lands on their row,
// while bookings with no therapist yet ride the left "Unallocated" rail. Drag a
// rail card onto a person to pre-assign them. Mirrors fetchStationBoard but keyed
// on therapist_id instead of resource_id.
async function fetchPeopleBoard(branchIds: string[], day: string): Promise<{ beds: BoardBed[]; blocks: BoardBlock[]; windowStartMin: number; windowEndMin: number; bedCount: number; staffShifts: BoardStaffShift[]; assignBeds: AssignBed[]; occupancy: BoardOccupancy }> {
  const supabase = createServiceClient();
  const branchId = branchIds[0];
  const brSet = new Set(branchIds);
  const nowClockMin = day === todayISO() ? tsToMin(new Date().toISOString()) : null;
  // Branch hours for the selected branches. The window opens at the earliest open
  // (lowered below if shifts start before open) and closes at the latest close;
  // place() folds genuine after-midnight times — before a midnight-crossing
  // branch's close — to the next day, NOT pre-open morning hours.
  const { data: brHoursAll } = await supabase.from('branches').select('id, open_time, close_time, therapist_share_group').in('id', branchIds);
  const branchHours = (brHoursAll ?? []).map((b) => ({ open: timeToMin(b.open_time ?? '10:00') ?? 600, close: timeToMin(b.close_time ?? '02:00') ?? 120 }));
  const branchOpen = Math.min(...branchHours.map((h) => h.open).concat([600]));
  const crossingCloses = branchHours.filter((h) => h.close <= h.open).map((h) => h.close);
  const wrapThreshold = crossingCloses.length ? Math.max(...crossingCloses) : -1;
  const place = (clockMin: number) => (clockMin < wrapThreshold ? clockMin + 1440 : clockMin);
  const isServicePosition = (code: string | null): boolean =>
    !!code && (code.startsWith('MASSAGE_') || code.startsWith('HAIR_') || code.startsWith('NAIL_'));

  // Multi-branch: the selected branch + its therapist-sharing group (∩ access),
  // so the group's therapists show on one board, grouped by Branch.
  // Map ALL branch codes (not just the filtered ones): a line assigned to a
  // cross-branch station must show that station's real branch, even when the
  // station's branch sits outside the current top-filter selection.
  const { data: brCodes } = await supabase.from('branches').select('id, code, therapist_share_group');
  const branchCodeById = new Map((brCodes ?? []).map((b) => [b.id, b.code]));
  // Therapist capacity pools the whole share group (each branch sees the full pool).
  const grpBranchSet = new Set(shareGroupBranchIds(brCodes ?? [], branchIds));

  const [empRes, shiftRes, itemsRes, bedsRes] = await Promise.all([
    // Rows = every active service therapist whose HOME branch is in the filter,
    // rostered today or not ("these are your branch's people"). Off-shift ones
    // still get a row; the board's "Available only" toggle hides the empties.
    supabase
      .from('employees')
      .select('id, name, employee_code, home_branch_id, position:positions ( code )')
      .in('home_branch_id', branchIds).eq('status', 'active'),
    // Today's shifts across ALL branches — matched to the home-branch therapists
    // below to paint each row's on-shift band. A loaned-out (cross_branch) therapist
    // has their shift at the OTHER branch, so shifts can't be filtered by branchIds.
    supabase
      .from('employee_shifts')
      .select('employee_id, branch_id, shift_start, shift_end, employees:employee_id ( position:positions ( code ) )')
      .eq('shift_date', day).in('shift_type', ['regular', 'cross_branch', 'on_call']),
    supabase
      .from('order_items')
      .select('id, status, therapist_id, resource_id, scheduled_start, service_start, slot_start, actual_start, actual_end, duration_minutes, list_price_cents, discount_amount_cents, final_amount_cents, external_room_no, service:service_items ( name, allowed_resource_types, service_category_id ), category:service_categories ( name, required_resource_type ), therapist:employees!order_items_therapist_id_fkey ( name ), guest:order_customers ( customer_name, seq_no ), resource:resources!order_items_resource_id_fkey ( resource_name, branch_id ), order:orders!order_items_order_id_fkey ( id, order_no, branch_id, service_date, status, service_location_type, total_cents, paid_cents, order_customers ( id ) )')
      .in('status', ['draft', 'in_service', 'service_completed', 'interrupted']),
    // Every active station in the share group — candidates for the People
    // popover's "Assign bed" picker (busy windows are derived from itemsRes below).
    supabase.from('resources').select('id, resource_name, resource_type, location_zone, branch_id').in('branch_id', branchIds).eq('status', 'active').order('resource_name'),
  ]);

  // Home-branch service therapists become the rows.
  const homeEmps = (empRes.data ?? []).filter((e) => isServicePosition(one(e.position)?.code ?? null));
  const homeEmpIds = new Set(homeEmps.map((e) => e.id));

  // On-shift band per therapist: the union of their shifts today, placed onto the
  // board's minute axis. No shift today → no band (an empty row). rawStarts feeds
  // the early-open widening (pre-open morning starts), placedEnds the late close.
  const bandByEmp = new Map<string, { start: number; end: number }>();
  const rawStarts: number[] = [];
  const placedEnds: number[] = [];
  for (const s of shiftRes.data ?? []) {
    if (!homeEmpIds.has(s.employee_id)) continue;
    const ss = timeToMin(s.shift_start); const se = timeToMin(s.shift_end);
    if (ss == null || se == null) continue;
    rawStarts.push(ss); placedEnds.push(place(se));
    const start = place(ss); const end = place(se);
    const prev = bandByEmp.get(s.employee_id);
    bandByEmp.set(s.employee_id, prev ? { start: Math.min(prev.start, start), end: Math.max(prev.end, end) } : { start, end });
  }

  // Open the window early enough to cover shifts that start before the branch
  // opens (e.g. 09:00 vs a 10:00 open) — only the few hours before open, so a
  // genuine after-midnight shift can't drag the window backwards.
  const earlyStarts = rawStarts.filter((m) => m < branchOpen && m >= branchOpen - 360);
  const windowStartMin = earlyStarts.length ? Math.min(branchOpen, ...earlyStarts) : branchOpen;
  const windowEndMin = Math.max(
    ...branchHours.map((h) => (h.close <= h.open ? h.close + 1440 : h.close)),
    ...placedEnds,
    windowStartMin + 60,
  );

  // Each home-branch therapist is a row, grouped under their HOME branch, painting
  // a faint "on shift" band when rostered today.
  const rowsById = new Map<string, BoardBed>();
  const staffShifts: BoardStaffShift[] = [];
  for (const e of homeEmps) {
    const positionCode = one(e.position)?.code ?? null;
    const band = bandByEmp.get(e.id) ?? null;
    rowsById.set(e.id, {
      id: e.id, name: e.name ?? '—', type: positionCode ?? '_other',
      shiftStartMin: band?.start ?? null, shiftEndMin: band?.end ?? null,
      branch: branchCodeById.get(e.home_branch_id ?? '') ?? '—', zone: '',
    });
    if (band) {
      staffShifts.push({ id: e.id, name: e.name ?? '—', code: e.employee_code ?? '', positionCode, startMin: band.start, endMin: band.end });
    }
  }

  const blocks: BoardBlock[] = [];
  // Per-bed busy windows (draft + in-service items that hold a bed) so the
  // People popover's "Assign bed" picker can offer only free stations.
  const bedBusy = new Map<string, { s: number; e: number }[]>();
  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || ord.service_date !== day || ord.status === 'void') continue;
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
    // A held bed (timed draft / live service) blocks that station for its window.
    if (it.resource_id && !untimed && (it.status === 'draft' || it.status === 'in_service')) {
      const arr = bedBusy.get(it.resource_id) ?? [];
      arr.push({ s: startMin, e: endMin });
      bedBusy.set(it.resource_id, arr);
    }
    const therapistId = it.therapist_id ?? null;
    // Inclusion: a line assigned to one of our home-branch therapists shows on
    // their row no matter which branch the order/station sits in — the person's
    // time is occupied. A still-unassigned line rides the rail only when its order
    // branch is in the filter (no therapist home branch to key it on yet).
    // (bedBusy above is intentionally computed for ALL bed-holding items first, so
    // the Assign-bed picker still sees a bed taken by a non-row therapist.)
    if (therapistId ? !rowsById.has(therapistId) : !brSet.has(ord.branch_id)) continue;
    // line2: dispatch shows hotel info; regular bookings show station / branch.
    const orderBranch = branchCodeById.get(ord.branch_id) ?? '—';
    const res = one(it.resource);
    const onSite = ord.service_location_type !== 'external_hotel';
    const bedUnassigned = onSite && !res;
    const line2 = ord.service_location_type === 'external_hotel'
      ? `Dispatch${it.external_room_no ? ` · Rm ${it.external_room_no}` : ''}`
      : res
        // Assigned station → its OWN branch (revenue follows the station). Never
        // fall back to the order branch: a cross-branch station kept showing the
        // order branch under a single-branch filter (e.g. HSPA2 bed read "HSPA1").
        ? `${branchCodeById.get(res.branch_id) ?? '—'} · ${res.resource_name}`
        : `${orderBranch} · not assigned`;
    // Station types this service may sit on (item-level allow-list wins, else the
    // category's required type) so the bed picker only offers compatible beds.
    const svc = one(it.service);
    const cat = one(it.category);
    const allowedResourceTypes = svc?.allowed_resource_types?.length
      ? svc.allowed_resource_types
      : cat?.required_resource_type ? [cat.required_resource_type] : [];
    blocks.push({
      key: `oi:${it.id}`, kind: 'order', refId: it.id, bedId: therapistId,
      guest: one(it.guest)?.customer_name ?? undefined, pax: 1,
      orderNo: ord.order_no ?? undefined, guestSeq: one(it.guest)?.seq_no ?? null,
      guestTotal: (ord as unknown as { order_customers?: { id: string }[] }).order_customers?.length ?? null,
      line1: fmtSvc(svc?.name ?? cat?.name),
      line2,
      startMin, endMin, durationMin: dur, prepMin: 0, cleanupMin: 0,
      variant, draggable: it.status === 'draft',
      orderId: ord.id, therapistId, untimed,
      owing: (ord.total_cents ?? 0) - (ord.paid_cents ?? 0) !== 0,
      balanceCents: (ord.total_cents ?? 0) - (ord.paid_cents ?? 0),
      listPriceCents: it.list_price_cents ?? null,
      discountCents: it.discount_amount_cents ?? null,
      finalAmountCents: it.final_amount_cents ?? null,
      bedUnassigned, allowedResourceTypes,
      // Red "needs assignment" when a not-yet-started booking lacks a therapist
      // or (on-site) a bed.
      needsAssignment: it.status === 'draft' && (!therapistId || bedUnassigned),
    });
  }

  const beds = [...rowsById.values()];
  const assignBeds: AssignBed[] = (bedsRes.data ?? []).map((bd) => ({
    id: bd.id, name: bd.resource_name, branch: branchCodeById.get(bd.branch_id) ?? '—',
    type: bd.resource_type, zone: bd.location_zone ?? null, busy: bedBusy.get(bd.id) ?? [],
  }));

  // ── Occupancy / utilization ──────────────────────────────────────────────
  // Therapist capacity = service therapists rostered AT the selected branches
  // today anywhere in the share group (employee_shifts.branch_id ∈ group + a
  // service position): therapists are a shared pool, so every branch in the group
  // sees the full pool. Bed capacity = active stations of the selection.
  // Demand windows reuse the items already fetched (scheduled + live + done).
  const placedNow = nowClockMin != null ? place(nowClockMin) : null;
  const capByEmp = new Map<string, OccWin>();
  for (const s of shiftRes.data ?? []) {
    if (!grpBranchSet.has(s.branch_id)) continue;
    const emp = one(s.employees);
    const code = emp ? one(emp.position)?.code ?? null : null;
    if (!isServicePosition(code)) continue;
    const ss = timeToMin(s.shift_start); const se = timeToMin(s.shift_end);
    if (ss == null || se == null) continue;
    const st = place(ss); const en = place(se);
    const prev = capByEmp.get(s.employee_id);
    capByEmp.set(s.employee_id, prev ? { s: Math.min(prev.s, st), e: Math.max(prev.e, en) } : { s: st, e: en });
  }
  const occBedBusy: OccWin[] = [];
  const occTherBusy: OccWin[] = [];
  const occActual: OccWin[] = [];
  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || !brSet.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void') continue;
    const dur = it.duration_minutes ?? 60;
    let s: number;
    let occEnd: number;
    if (it.status === 'draft') {
      const sIso = it.scheduled_start ?? it.service_start ?? it.slot_start;
      if (!sIso) continue;
      s = place(tsToMin(sIso)); occEnd = s + dur;
    } else {
      if (!it.actual_start) continue;
      s = place(tsToMin(it.actual_start));
      occEnd = it.actual_end ? place(tsToMin(it.actual_end)) : s + dur;
      const actEnd = it.actual_end ? place(tsToMin(it.actual_end)) : (placedNow != null ? Math.max(s, placedNow) : s + dur);
      occActual.push({ s, e: actEnd });
    }
    if (it.resource_id) occBedBusy.push({ s, e: occEnd });
    if (it.therapist_id) occTherBusy.push({ s, e: occEnd });
  }
  const sg = shareGroupComputable((brHoursAll ?? []).map((b) => b.therapist_share_group ?? null));
  const occupancy = buildOccupancy({
    computable: sg.ok,
    note: sg.note,
    windowStartMin,
    windowEndMin,
    stationCount: (bedsRes.data ?? []).length,
    shifts: [...capByEmp.values()],
    bedBusy: occBedBusy,
    therBusy: occTherBusy,
    actual: occActual,
  });

  return { beds, blocks, windowStartMin, windowEndMin, bedCount: beds.length, staffShifts, assignBeds, occupancy };
}
// Option lists for the board's click-to-add (reuses NewReservationDialog).
async function fetchBoardDialogData(): Promise<BoardDialogData> {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const [br, src, cat, si] = await Promise.all([
    supabase.from('branches').select('id, code, name, branch_business_units ( business_unit_id )').eq('active', true).order('code'),
    supabase.from('customer_sources').select('id, code, name, phone_required').eq('active', true).order('code'),
    supabase.from('service_categories').select('id, code, name, required_resource_type, required_resource_types, service_category_business_units ( business_unit_id )').eq('active', true).order('code'),
    supabase.from('service_items').select('id, name, service_group, service_category_id, duration_minutes').eq('active', true).order('service_group'),
  ]);
  const branches = (br.data ?? []).filter((b) => allowed.has(b.id)).map((b) => ({
    id: b.id, code: b.code, name: b.name, businessUnitIds: (b.branch_business_units ?? []).map((x) => x.business_unit_id),
  }));
  const serviceCategories = (cat.data ?? []).map((c) => ({
    id: c.id, code: c.code, name: c.name,
    businessUnitIds: (c.service_category_business_units ?? []).map((x) => x.business_unit_id),
    requiredResourceType: c.required_resource_type,
    requiredResourceTypes: c.required_resource_types ?? [],
  }));
  const serviceItems = (si.data ?? [])
    .filter((s) => s.service_group)
    .map((s) => ({ id: s.id, name: s.name, group: s.service_group as string, categoryId: s.service_category_id as string, durationMinutes: s.duration_minutes ?? null }));
  return { branches, sources: src.data ?? [], serviceCategories, serviceItems };
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Minutes of overlap between [a,b) and [c,d).
function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

// Occupancy/utilization is only meaningful when the selected branches pool the
// same therapist labour. One branch is always fine; multiple are poolable only
// when they share one (non-null) therapist_share_group.
function shareGroupComputable(groups: (string | null)[]): { ok: boolean; note: string | null } {
  if (groups.length <= 1) return { ok: true, note: null };
  if (groups.some((g) => !g) || new Set(groups).size > 1) {
    return { ok: false, note: 'selected branches are not in one therapist share group' };
  }
  return { ok: true, note: null };
}

// The therapist pool spans the whole share group (each branch sees the full
// pool), so capacity counts shifts at every branch sharing the selection's
// group. A branch with no group — or a selection spanning groups (not
// computable anyway) — falls back to just the selected branches.
function shareGroupBranchIds(allBranches: { id: string; therapist_share_group: string | null }[], selectedIds: string[]): string[] {
  const sel = allBranches.filter((b) => selectedIds.includes(b.id));
  const groups = sel.map((b) => b.therapist_share_group ?? null);
  const sameGroup = selectedIds.length <= 1 || (!groups.some((g) => !g) && new Set(groups).size === 1);
  const common = groups[0] ?? null;
  if (!sameGroup || !common) return selectedIds;
  return allBranches.filter((b) => b.therapist_share_group === common).map((b) => b.id);
}

type OccWin = { s: number; e: number };

// Turn prepared capacity/demand windows (already in board-minute space) into the
// per-hour occupancies + the day-level utilization against min(beds, therapists).
function buildOccupancy(p: {
  computable: boolean;
  note: string | null;
  windowStartMin: number;
  windowEndMin: number;
  stationCount: number;
  shifts: OccWin[];   // service-therapist shifts rostered AT the selected branches
  bedBusy: OccWin[];  // bed-holding bookings (scheduled + live + done)
  therBusy: OccWin[]; // therapist-holding bookings (scheduled + live + done)
  actual: OccWin[];   // delivered service windows (utilization numerator)
}): BoardOccupancy {
  if (!p.computable) {
    return { computable: false, note: p.note, perHour: [], bedHours: 0, therapistHours: 0, stationCount: p.stationCount, therapistCount: p.shifts.length, capacityHours: 0, actualHours: 0, utilizationPct: null, stationOccPct: null, therapistOccPct: null };
  }
  const ws = p.windowStartMin;
  const we = p.windowEndMin;
  const firstHour = Math.floor(ws / 60);
  const lastHour = Math.ceil(we / 60);
  const perHour: BoardOccupancy['perHour'] = [];
  for (let h = firstHour; h < lastHour; h++) {
    const hs = h * 60;
    const he = hs + 60;
    const bedCapMin = p.stationCount * overlap(hs, he, ws, we);
    const therCapMin = p.shifts.reduce((s, w) => s + overlap(hs, he, w.s, w.e), 0);
    const bedOccMin = p.bedBusy.reduce((s, w) => s + overlap(hs, he, w.s, w.e), 0);
    const therOccMin = p.therBusy.reduce((s, w) => s + overlap(hs, he, w.s, w.e), 0);
    perHour.push({
      hour: h,
      stationPct: bedCapMin > 0 ? bedOccMin / bedCapMin : null,
      therapistPct: therCapMin > 0 ? therOccMin / therCapMin : null,
    });
  }
  const bedHours = (p.stationCount * (we - ws)) / 60;
  const therapistHours = p.shifts.reduce((s, w) => s + overlap(ws, we, w.s, w.e), 0) / 60;
  const capacityHours = Math.min(bedHours, therapistHours);
  const actualHours = p.actual.reduce((s, w) => s + overlap(ws, we, w.s, w.e), 0) / 60;
  const bedOccHours = p.bedBusy.reduce((s, w) => s + overlap(ws, we, w.s, w.e), 0) / 60;
  const therOccHours = p.therBusy.reduce((s, w) => s + overlap(ws, we, w.s, w.e), 0) / 60;
  return {
    computable: true,
    note: null,
    perHour,
    bedHours,
    therapistHours,
    stationCount: p.stationCount,
    therapistCount: p.shifts.length,
    capacityHours,
    actualHours,
    utilizationPct: capacityHours > 0 ? actualHours / capacityHours : null,
    stationOccPct: bedHours > 0 ? bedOccHours / bedHours : null,
    therapistOccPct: therapistHours > 0 ? therOccHours / therapistHours : null,
  };
}

async function fetchBranches(branchParam?: string): Promise<{ branches: { id: string; code: string; name: string }[]; branchIds: string[] }> {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const { data } = await supabase
    .from('branches').select('id, code, name').eq('active', true).order('code');
  const list = (data ?? []).filter((b) => allowed.has(b.id));
  const requested = (branchParam ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const valid = requested.filter((id) => list.some((b) => b.id === id));
  // No explicit ?branch → default to ALL accessible branches selected, not just
  // the first one, so a multi-branch user lands on the full picture.
  const branchIds = valid.length ? valid : list.map((b) => b.id);
  return { branches: list, branchIds };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; view?: string; day?: string }>;
}) {
  const sp = await searchParams;
  // People (therapist-keyed board) is the default; Station is the same board
  // keyed on beds/stations.
  const view: CalendarView = sp.view === 'station' ? 'station' : 'people';
  const day = sp.day || todayISO();
  const { branches, branchIds } = await fetchBranches(sp.branch);
  const branchId = branchIds[0];

  const stationBoard = view === 'station' && branchId ? await fetchStationBoard(branchIds, day) : null;
  const peopleBoard = view === 'people' && branchId ? await fetchPeopleBoard(branchIds, day) : null;
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
        {branchId && boardDialog && <ShiftControls branches={branches} branchId={branchId} selected={branchIds} day={day} view={view} dialog={boardDialog} />}
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
          occupancy={stationBoard.occupancy}
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
          assignBeds={peopleBoard.assignBeds}
          occupancy={peopleBoard.occupancy}
        />
      ) : (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Pick Station or People to view the board.
        </Card>
      )}
    </div>
  );
}