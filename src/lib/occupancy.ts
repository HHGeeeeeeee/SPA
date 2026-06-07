import { createServiceClient } from '@/lib/supabase/server';

// Day-level + per-hour utilization for a set of branches on one service day.
// Utilization = delivered service-hours / the true bottleneck capacity
// min(station-hours, therapist-hours). Capacity counts active stations and the
// service therapists actually rostered AT these branches today (so loaned-in
// cross-branch staff count, loaned-out don't). `computable` is false when more
// than one branch is selected and they aren't all in one therapist share group
// — pooling therapist capacity across non-sharing branches is meaningless.
export interface DayOccupancy {
  computable: boolean;
  note: string | null;
  bedHours: number;
  therapistHours: number;
  stationCount: number;
  therapistCount: number;
  capacityHours: number;
  actualHours: number;
  utilizationPct: number | null;
  stationOccPct: number | null;    // day avg occupied bed-hours / bedHours
  therapistOccPct: number | null;  // day avg occupied therapist-hours / therapistHours
  absentHours: number;             // shift-hours lost to therapist absence blocks today
  // One entry per operating hour (placed-hour ints; >24 after midnight).
  // revenueCents = service revenue recognised in that hour (delivered services'
  // list price, by start hour) — drawn as a background area on the chart.
  perHour: { hour: number; stationPct: number | null; therapistPct: number | null; utilizationPct: number | null; revenueCents: number }[];
}

type Win = { s: number; e: number };

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
function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}
function isServicePosition(code: string | null): boolean {
  return !!code && (code.startsWith('MASSAGE_') || code.startsWith('HAIR_') || code.startsWith('NAIL_'));
}
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const EMPTY: DayOccupancy = {
  computable: true, note: null, bedHours: 0, therapistHours: 0, stationCount: 0, therapistCount: 0,
  capacityHours: 0, actualHours: 0, utilizationPct: null, stationOccPct: null, therapistOccPct: null, absentHours: 0, perHour: [],
};

export async function computeDayOccupancy(branchIds: string[], day: string, nowIso?: string): Promise<DayOccupancy> {
  if (!branchIds.length) return EMPTY;
  const supabase = createServiceClient();

  const [brRes, resRes, shiftRes, itemsRes, blockRes] = await Promise.all([
    // ALL active branches — needed to expand the therapist pool to the whole
    // share group, not just the selected branches.
    supabase.from('branches').select('id, open_time, close_time, therapist_share_group').eq('active', true),
    supabase.from('resources').select('id').in('branch_id', branchIds).eq('status', 'active'),
    supabase
      .from('employee_shifts')
      .select('employee_id, branch_id, shift_start, shift_end, employees:employee_id ( position:positions ( code ) )')
      .eq('shift_date', day).in('shift_type', ['regular', 'cross_branch', 'on_call']),
    supabase
      .from('order_items')
      .select('id, status, duration_minutes, list_price_cents, resource_id, therapist_id, scheduled_start, slot_start, slot_end, actual_start, actual_end, order:orders!order_items_order_id_fkey ( branch_id, service_date, status )')
      .in('status', ['draft', 'in_service', 'service_completed', 'interrupted']),
    // Today's therapist absence blocks (late / stepped out / early leave) — the
    // hours subtracted from rostered capacity below.
    supabase.from('therapist_block').select('employee_id, start_at, end_at').eq('block_date', day),
  ]);

  const brAll = brRes.data ?? [];
  const selBr = brAll.filter((b) => branchIds.includes(b.id));

  // Share-group gate: a multi-branch selection only pools when all selected
  // branches share one (non-null) group — spanning groups → not computable.
  const groups = selBr.map((b) => b.therapist_share_group ?? null);
  if (branchIds.length > 1 && (groups.some((g) => !g) || new Set(groups).size > 1)) {
    return { ...EMPTY, computable: false, note: 'selected branches span more than one therapist share group' };
  }

  // Therapist pool = the whole share group (each branch sees the full pool). A
  // branch with no group is just itself. Beds/demand stay on the selection.
  const commonGroup = groups[0] ?? null;
  const groupBranchSet = new Set(commonGroup ? brAll.filter((b) => b.therapist_share_group === commonGroup).map((b) => b.id) : branchIds);

  // Window: earliest open → latest close of the SELECTED branches (union).
  // place() folds only genuine after-midnight times (before a midnight-crossing
  // branch's close) to the next day — NOT pre-open morning hours, so a shift that
  // starts before open (e.g. 09:00 vs a 10:00 open) stays in the morning.
  const hours = selBr.map((b) => ({ open: timeToMin(b.open_time ?? '10:00') ?? 600, close: timeToMin(b.close_time ?? '02:00') ?? 120 }));
  const branchOpen = Math.min(...hours.map((h) => h.open).concat([600]));
  const crossingCloses = hours.filter((h) => h.close <= h.open).map((h) => h.close);
  const wrapThreshold = crossingCloses.length ? Math.max(...crossingCloses) : -1;
  const place = (clockMin: number) => (clockMin < wrapThreshold ? clockMin + 1440 : clockMin);
  const nowMin = nowIso ? place(tsToMin(nowIso)) : null;

  const stationCount = (resRes.data ?? []).length;
  const brSet = new Set(branchIds);

  // Therapist capacity: service therapists rostered today anywhere in the share
  // group (one merged window per person, so a split/loaned shift doesn't
  // double-count). rawStarts feeds the early-open widening; placedEnds the late close.
  const capByEmp = new Map<string, Win>();
  const rawStarts: number[] = [];
  const placedEnds: number[] = [];
  for (const s of shiftRes.data ?? []) {
    if (!groupBranchSet.has(s.branch_id)) continue;
    const emp = one(s.employees);
    const code = emp ? one(emp.position)?.code ?? null : null;
    if (!isServicePosition(code)) continue;
    const ss = timeToMin(s.shift_start); const se = timeToMin(s.shift_end);
    if (ss == null || se == null) continue;
    const st = place(ss); const en = place(se);
    rawStarts.push(ss); placedEnds.push(en);
    const prev = capByEmp.get(s.employee_id);
    capByEmp.set(s.employee_id, prev ? { s: Math.min(prev.s, st), e: Math.max(prev.e, en) } : { s: st, e: en });
  }
  const shifts = [...capByEmp.values()];

  // Open the window early enough to cover shifts that start before the branch
  // opens (only the few hours before open, so a genuine after-midnight time can't
  // drag it backwards); close it at the latest of branch close / shift end.
  const earlyStarts = rawStarts.filter((m) => m < branchOpen && m >= branchOpen - 360);
  const windowStartMin = earlyStarts.length ? Math.min(branchOpen, ...earlyStarts) : branchOpen;
  const windowEndMin = Math.max(
    ...hours.map((h) => (h.close <= h.open ? h.close + 1440 : h.close)),
    ...placedEnds,
    windowStartMin + 60,
  );

  // Absent hours = each absence block's overlap with that therapist's rostered
  // capacity window (off-shift / non-pool absences cost nothing), summed.
  let absentMin = 0;
  for (const bl of blockRes.data ?? []) {
    const cap = capByEmp.get(bl.employee_id);
    if (!cap) continue;
    absentMin += overlap(place(tsToMin(bl.start_at)), place(tsToMin(bl.end_at)), cap.s, cap.e);
  }
  const absentHours = absentMin / 60;

  // Demand windows. Occupancy (booked) counts scheduled drafts + live + done as
  // holding a bed / a therapist; utilization counts only DELIVERED service
  // (completed/interrupted span, live elapsed to now).
  const bedBusy: Win[] = [];
  const therBusy: Win[] = [];
  const actual: Win[] = [];
  // Revenue recognised per placed-hour = delivered services' list price booked at
  // the hour the service started (revenue posts at in_service).
  const revByHour = new Map<number, number>();
  for (const it of itemsRes.data ?? []) {
    const ord = one(it.order);
    if (!ord || !brSet.has(ord.branch_id) || ord.service_date !== day || ord.status === 'void') continue;
    const dur = it.duration_minutes ?? 60;
    let s: number;
    let occEnd: number;
    if (it.status === 'draft') {
      const sIso = it.scheduled_start ?? it.slot_start;
      if (!sIso) continue; // untimed → can't attribute to an hour
      s = place(tsToMin(sIso)); occEnd = s + dur;
    } else {
      // Delivered window = booked block (slot_*), capped on finish.
      const sIso = it.slot_start ?? it.actual_start ?? it.scheduled_start;
      if (!sIso) continue;
      s = place(tsToMin(sIso));
      occEnd = it.slot_end ? place(tsToMin(it.slot_end)) : s + dur;
      const actEnd = it.slot_end ? place(tsToMin(it.slot_end)) : (nowMin != null ? Math.max(s, nowMin) : s + dur);
      actual.push({ s, e: actEnd });
      const h = Math.floor(s / 60);
      revByHour.set(h, (revByHour.get(h) ?? 0) + (it.list_price_cents ?? 0));
    }
    if (it.resource_id) bedBusy.push({ s, e: occEnd });
    if (it.therapist_id) therBusy.push({ s, e: occEnd });
  }

  const span = (wins: Win[], a: number, b: number) => wins.reduce((sum, w) => sum + overlap(a, b, w.s, w.e), 0);
  const bedHours = (stationCount * (windowEndMin - windowStartMin)) / 60;
  const therapistHours = span(shifts, windowStartMin, windowEndMin) / 60;
  const capacityHours = Math.min(bedHours, therapistHours);
  const actualHours = span(actual, windowStartMin, windowEndMin) / 60;
  const bedOccHours = span(bedBusy, windowStartMin, windowEndMin) / 60;
  const therOccHours = span(therBusy, windowStartMin, windowEndMin) / 60;

  const perHour: DayOccupancy['perHour'] = [];
  const firstHour = Math.floor(windowStartMin / 60);
  const lastHour = Math.ceil(windowEndMin / 60);
  for (let h = firstHour; h < lastHour; h++) {
    const hs = h * 60; const he = hs + 60;
    const bedCap = stationCount * overlap(hs, he, windowStartMin, windowEndMin);
    const therCap = span(shifts, hs, he);
    const cap = Math.min(bedCap, therCap);
    perHour.push({
      hour: h,
      stationPct: bedCap > 0 ? span(bedBusy, hs, he) / bedCap : null,
      therapistPct: therCap > 0 ? span(therBusy, hs, he) / therCap : null,
      utilizationPct: cap > 0 ? span(actual, hs, he) / cap : null,
      revenueCents: revByHour.get(h) ?? 0,
    });
  }

  return {
    computable: true, note: null, bedHours, therapistHours,
    stationCount, therapistCount: shifts.length,
    capacityHours, actualHours,
    utilizationPct: capacityHours > 0 ? actualHours / capacityHours : null,
    stationOccPct: bedHours > 0 ? bedOccHours / bedHours : null,
    therapistOccPct: therapistHours > 0 ? therOccHours / therapistHours : null,
    absentHours,
    perHour,
  };
}
