import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { ShiftCell, type ShiftData } from '@/components/shift-schedule/shift-cell';
import { DayTimeline, type DayRow, type ReservationBlock } from '@/components/shift-schedule/day-timeline';
import { cancelStaleReservations, getReservationGraceMinutes, isReservationOverdue } from '@/lib/reservations';

export const dynamic = 'force-dynamic';

const TIMED = ['regular', 'cross_branch', 'on_call'];

type ShiftView = 'employee' | 'station';
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

// Day (hourly) view for either subject. Therapist rows show each rostered
// therapist's working window + their actual service blocks; Station rows show
// each bed's occupancy from actual service times.
async function fetchDayData(subject: ShiftView, branchId: string, day: string): Promise<{ rows: DayRow[]; windowStartMin: number; windowEndMin: number; reservations: ReservationBlock[] }> {
  const supabase = createServiceClient();
  const { data: itemData } = await supabase
    .from('order_items')
    .select('id, therapist_id, resource_id, actual_start, actual_end, bed_released_at, duration_minutes, service:service_items ( name, prep_before_minutes, cleanup_after_minutes ), therapist:employees!order_items_therapist_id_fkey ( name, employee_code ), order:orders!order_items_order_id_fkey ( id, branch_id, service_date )')
    .not('actual_start', 'is', null);
  const dayItems = (itemData ?? []).filter((it) => {
    const ord = one(it.order);
    return ord && ord.branch_id === branchId && ord.service_date === day && it.actual_start;
  });

  // Upcoming reservations (not yet converted to an order) for this branch/day.
  // Unpinned ones ride the top "Reservations" lane; ones with pinned beds show
  // as ghost blocks in those bed rows (Station view only).
  const { data: resvData } = await supabase
    .from('reservations')
    .select('id, status, guest_name, pax, desired_service_start, desired_service_end, service_location_type, customer_sources ( code ), reservation_service_categories ( service_categories ( name ) ), reservation_resources ( resource_id )')
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
    return {
      id: r.id,
      guest: r.guest_name ?? 'Guest',
      line2: [cats || 'Service', src, r.pax > 1 ? `${r.pax}p` : null].filter(Boolean).join(' · '),
      startMin: tsToMin(r.desired_service_start),
      endMin: tsToMin(r.desired_service_end),
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
      const startMin = tsToMin(it.actual_start!);
      const endMin = it.actual_end ? tsToMin(it.actual_end) : Math.min(1439, startMin + (it.duration_minutes ?? 60) + (one(it.service)?.prep_before_minutes ?? 0));
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
        arr.push({ line1: rr.guest, line2: rr.line2, startMin: rr.startMin, endMin: rr.endMin, ongoing: false, reservation: true, reservationId: rr.id });
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
      const endMin = it.actual_end ? tsToMin(it.actual_end) : Math.min(1439, startMin + (it.duration_minutes ?? 60) + (one(it.service)?.prep_before_minutes ?? 0));
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
  const reservations: ReservationBlock[] = (subject === 'station' ? resvRows.filter((r) => r.pending || r.pinnedIds.length === 0 || r.overdue) : resvRows)
    .map((r) => ({ id: r.id, guest: r.guest, line2: r.line2, startMin: r.startMin, endMin: r.endMin, external: r.external, overdue: r.overdue, pending: r.pending }));
  for (const r of reservations) allMins.push(r.startMin, r.endMin);
  const windowStartMin = allMins.length ? Math.min(540, Math.floor(Math.min(...allMins) / 60) * 60) : 540;
  const windowEndMin = allMins.length ? Math.max(1320, Math.ceil(Math.max(...allMins) / 60) * 60) : 1320;
  return { rows, windowStartMin, windowEndMin, reservations };
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
  const { data: branches } = await supabase
    .from('branches').select('id, code, name, therapist_share_group').eq('active', true).order('code');
  const list = branches ?? [];
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
  await cancelStaleReservations(); // sweep past-day no-shows → cancelled
  // Station (live bed occupancy) is the default subject; Therapist is opt-in.
  const view: ShiftView = sp.view === 'employee' ? 'employee' : 'station';
  // The roster only plans working hours; beds are assigned dynamically when a
  // service starts. So the Station subject is a live, per-day occupancy snapshot
  // (sourced from actual orders) and is never a weekly pre-assignment grid.
  const scale: ShiftScale = view === 'station' ? 'day' : sp.scale === 'day' ? 'day' : 'week';
  const day = sp.day || todayISO();
  const { branches, branchId, monday, days, employees, shifts } = await fetchData(sp.branch, sp.week);
  const dayData = scale === 'day' && branchId ? await fetchDayData(view, branchId, day) : null;

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
              ? `${day} · hourly · ${view === 'station' ? 'live bed occupancy (from orders)' : 'therapist hours & services'}`
              : `Week of ${monday} · home-branch therapists · click a cell to set a shift`}
          </p>
        </div>
        {branchId && <ShiftControls branches={branches} branchId={branchId} weekStart={monday} day={day} view={view} scale={scale} />}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : scale === 'day' ? (
        <DayTimeline rows={dayData!.rows} windowStartMin={dayData!.windowStartMin} windowEndMin={dayData!.windowEndMin} subjectLabel={view === 'station' ? 'Station' : 'Therapist'} nowMin={day === todayISO() ? tsToMin(new Date().toISOString()) : null} reservations={dayData!.reservations} />
      ) : employees.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          No active therapists for this branch (or its sharing group).
        </Card>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-bold text-sm p-3 w-48 sticky left-0 bg-card">Therapist</th>
                {days.map((d) => (
                  <th key={d.date} className="text-center font-bold text-xs p-2 min-w-[88px]">
                    <div>{d.dow}</div>
                    <div className="font-medium text-muted-foreground tabular">{d.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="p-3 sticky left-0 bg-card">
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
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-primary/15" /> Regular</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-amber-500/15" /> Cross-branch</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-blue-500/15" /> On-call</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-muted" /> Off</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-destructive/15" /> Leave</span>
        {view === 'station' && (
          <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-zinc-500/50 bg-zinc-400/75" /> Bed cleanup</span>
        )}
        {scale === 'day' && (
          <>
            <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-amber-500/70 bg-amber-500/15" /> Reservation — pending</span>
            <span className="inline-flex items-center gap-1"><span className="size-3 rounded border border-dashed border-violet-500/70 bg-violet-500/20" /> Reservation — confirmed</span>
          </>
        )}
      </div>
    </div>
  );
}
