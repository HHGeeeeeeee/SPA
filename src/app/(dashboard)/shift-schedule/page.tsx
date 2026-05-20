import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { ShiftCell, type ShiftData } from '@/components/shift-schedule/shift-cell';
import { StationShiftCell, type StationAssignment } from '@/components/shift-schedule/station-shift-cell';
import { DayTimeline, type DayRow } from '@/components/shift-schedule/day-timeline';

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
async function fetchDayData(subject: ShiftView, branchId: string, day: string): Promise<{ rows: DayRow[]; windowStartMin: number; windowEndMin: number }> {
  const supabase = createServiceClient();
  const { data: itemData } = await supabase
    .from('order_items')
    .select('therapist_id, resource_id, actual_start, actual_end, duration_minutes, service:service_items ( name ), therapist:employees!order_items_therapist_id_fkey ( name ), order:orders!order_items_order_id_fkey ( branch_id, service_date )')
    .not('actual_start', 'is', null);
  const dayItems = (itemData ?? []).filter((it) => {
    const ord = one(it.order);
    return ord && ord.branch_id === branchId && ord.service_date === day && it.actual_start;
  });

  let rows: DayRow[];
  if (subject === 'station') {
    const { data: stations } = await supabase
      .from('resources').select('id, resource_name').eq('branch_id', branchId).eq('status', 'active').order('resource_name');
    const byStation = new Map<string, { name: string; startMin: number; endMin: number; ongoing: boolean }[]>();
    for (const it of dayItems) {
      if (!it.resource_id) continue;
      const startMin = tsToMin(it.actual_start!);
      const endMin = it.actual_end ? tsToMin(it.actual_end) : Math.min(1439, startMin + (it.duration_minutes ?? 60));
      const arr = byStation.get(it.resource_id) ?? [];
      arr.push({ name: one(it.therapist)?.name ?? one(it.service)?.name ?? 'Service', startMin, endMin, ongoing: !it.actual_end });
      byStation.set(it.resource_id, arr);
    }
    rows = (stations ?? []).map((s) => ({
      id: s.id, name: s.resource_name, code: '', shiftType: 'regular',
      shiftStartMin: null, shiftEndMin: null, services: byStation.get(s.id) ?? [],
    }));
  } else {
    const { data: shifts } = await supabase
      .from('employee_shifts')
      .select('employee_id, shift_type, shift_start, shift_end, employees:employee_id ( name, employee_code )')
      .eq('branch_id', branchId).eq('shift_date', day).in('shift_type', TIMED);
    const byTherapist = new Map<string, { name: string; startMin: number; endMin: number; ongoing: boolean }[]>();
    for (const it of dayItems) {
      if (!it.therapist_id) continue;
      const startMin = tsToMin(it.actual_start!);
      const endMin = it.actual_end ? tsToMin(it.actual_end) : Math.min(1439, startMin + (it.duration_minutes ?? 60));
      const arr = byTherapist.get(it.therapist_id) ?? [];
      arr.push({ name: one(it.service)?.name ?? 'Service', startMin, endMin, ongoing: !it.actual_end });
      byTherapist.set(it.therapist_id, arr);
    }
    rows = (shifts ?? []).map((s) => {
      const emp = one(s.employees);
      return {
        id: s.employee_id, name: emp?.name ?? '—', code: emp?.employee_code ?? '', shiftType: s.shift_type,
        shiftStartMin: timeToMin(s.shift_start), shiftEndMin: timeToMin(s.shift_end),
        services: byTherapist.get(s.employee_id) ?? [],
      };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }

  const allMins: number[] = [];
  for (const r of rows) {
    if (r.shiftStartMin != null) allMins.push(r.shiftStartMin);
    if (r.shiftEndMin != null) allMins.push(r.shiftEndMin);
    for (const s of r.services) allMins.push(s.startMin, s.endMin);
  }
  const windowStartMin = allMins.length ? Math.min(540, Math.floor(Math.min(...allMins) / 60) * 60) : 540;
  const windowEndMin = allMins.length ? Math.max(1320, Math.ceil(Math.max(...allMins) / 60) * 60) : 1320;
  return { rows, windowStartMin, windowEndMin };
}

interface ShiftRow {
  employee_id: string;
  shift_date: string;
  shift_type: string;
  shift_start: string | null;
  shift_end: string | null;
  leave_type: string | null;
  resource_id: string | null;
  employees: { name: string; employee_code: string } | { name: string; employee_code: string }[] | null;
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
    .from('branches').select('id, code, name').eq('active', true).order('code');
  const list = branches ?? [];
  const branchId = branchParam && list.some((b) => b.id === branchParam) ? branchParam : list[0]?.id;
  const monday = weekParam ?? thisMonday();
  const days = weekDays(monday);

  let employees: { id: string; employee_code: string; name: string }[] = [];
  let shifts: ShiftRow[] = [];
  let stations: { id: string; name: string }[] = [];
  if (branchId) {
    const [emp, sh, res] = await Promise.all([
      supabase.from('employees').select('id, employee_code, name').eq('home_branch_id', branchId).eq('status', 'active').order('employee_code'),
      supabase.from('employee_shifts')
        .select('employee_id, shift_date, shift_type, shift_start, shift_end, leave_type, resource_id, employees:employee_id ( name, employee_code )')
        .eq('branch_id', branchId)
        .gte('shift_date', days[0].date)
        .lte('shift_date', days[6].date),
      supabase.from('resources').select('id, resource_name').eq('branch_id', branchId).eq('status', 'active').order('resource_name'),
    ]);
    employees = emp.data ?? [];
    shifts = (sh.data ?? []) as ShiftRow[];
    stations = (res.data ?? []).map((r) => ({ id: r.id, name: r.resource_name }));
  }

  return { branches: list, branchId, monday, days, employees, shifts, stations };
}

export default async function ShiftSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; week?: string; view?: string; scale?: string; day?: string }>;
}) {
  const sp = await searchParams;
  const view: ShiftView = sp.view === 'station' ? 'station' : 'employee';
  const scale: ShiftScale = sp.scale === 'day' ? 'day' : 'week';
  const day = sp.day || todayISO();
  const { branches, branchId, monday, days, employees, shifts, stations } = await fetchData(sp.branch, sp.week);
  const dayData = scale === 'day' && branchId ? await fetchDayData(view, branchId, day) : null;

  const shiftAt = (empId: string, date: string): ShiftData | null => {
    const s = shifts.find((x) => x.employee_id === empId && x.shift_date === date);
    return s
      ? { shift_type: s.shift_type, shift_start: s.shift_start, shift_end: s.shift_end, leave_type: s.leave_type, resource_id: s.resource_id }
      : null;
  };

  const assignmentsAt = (stationId: string, date: string): StationAssignment[] =>
    shifts
      .filter((s) => s.resource_id === stationId && s.shift_date === date && TIMED.includes(s.shift_type))
      .map((s) => {
        const emp = one(s.employees);
        return {
          employeeId: s.employee_id,
          employeeName: emp?.name ?? '—',
          employeeCode: emp?.employee_code ?? '',
          shiftType: s.shift_type,
          shiftStart: s.shift_start,
          shiftEnd: s.shift_end,
        };
      });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Shift Schedule</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {scale === 'day'
              ? `${day} · hourly · ${view === 'station' ? 'bed occupancy' : 'therapist hours & services'}`
              : `Week of ${monday} · ${view === 'station' ? 'stations × days · click a cell to assign a therapist' : 'home-branch therapists · click a cell to set a shift'}`}
          </p>
        </div>
        {branchId && <ShiftControls branches={branches} branchId={branchId} weekStart={monday} day={day} view={view} scale={scale} />}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : scale === 'day' ? (
        <DayTimeline rows={dayData!.rows} windowStartMin={dayData!.windowStartMin} windowEndMin={dayData!.windowEndMin} />
      ) : view === 'employee' ? (
        employees.length === 0 ? (
          <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
            No active employees with this branch as their home branch.
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
                      <div className="font-semibold text-sm">{e.name}</div>
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
                          stations={stations}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : stations.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          No active stations at this branch. Add beds / rooms in Settings → Service Stations.
        </Card>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-bold text-sm p-3 w-48 sticky left-0 bg-card">Station</th>
                {days.map((d) => (
                  <th key={d.date} className="text-center font-bold text-xs p-2 min-w-[104px]">
                    <div>{d.dow}</div>
                    <div className="font-medium text-muted-foreground tabular">{d.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stations.map((st) => (
                <tr key={st.id} className="border-b border-border last:border-0">
                  <td className="p-3 sticky left-0 bg-card">
                    <div className="font-semibold text-sm">{st.name}</div>
                  </td>
                  {days.map((d) => (
                    <td key={d.date} className="p-1 align-top">
                      <StationShiftCell
                        branchId={branchId}
                        date={d.date}
                        station={st}
                        assignments={assignmentsAt(st.id, d.date)}
                        employees={employees}
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
      </div>
    </div>
  );
}
