import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShiftControls } from '@/components/shift-schedule/shift-controls';
import { ShiftCell, type ShiftData } from '@/components/shift-schedule/shift-cell';
import { StationShiftCell, type StationAssignment } from '@/components/shift-schedule/station-shift-cell';
import { DispatchTherapist, type DispatchableEmployee } from '@/components/shift-schedule/dispatch-therapist';

export const dynamic = 'force-dynamic';

const TIMED = ['regular', 'cross_branch', 'on_call'];

type ShiftView = 'employee' | 'station';

interface RosterEmployee {
  id: string;
  employee_code: string;
  name: string;
  homeBranchCode: string | null;
  dispatched: boolean;
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

  let employees: RosterEmployee[] = [];
  let dispatchable: DispatchableEmployee[] = [];
  let shifts: ShiftRow[] = [];
  let stations: { id: string; name: string }[] = [];
  if (branchId) {
    const [emp, sh, res] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, name, home_branch_id, home_branch:branches ( code )')
        .eq('status', 'active')
        .order('employee_code'),
      supabase.from('employee_shifts')
        .select('employee_id, shift_date, shift_type, shift_start, shift_end, leave_type, resource_id, employees:employee_id ( name, employee_code )')
        .eq('branch_id', branchId)
        .gte('shift_date', days[0].date)
        .lte('shift_date', days[6].date),
      supabase.from('resources').select('id, resource_name').eq('branch_id', branchId).eq('status', 'active').order('resource_name'),
    ]);
    shifts = (sh.data ?? []) as ShiftRow[];
    stations = (res.data ?? []).map((r) => ({ id: r.id, name: r.resource_name }));

    const allEmps = (emp.data ?? []).map((e) => ({
      id: e.id,
      employee_code: e.employee_code,
      name: e.name,
      home_branch_id: e.home_branch_id as string | null,
      homeBranchCode: one(e.home_branch)?.code ?? null,
    }));
    // Roster rows = home-branch therapists + anyone already rostered here this week.
    const shiftEmpIds = new Set(shifts.map((s) => s.employee_id));
    employees = allEmps
      .filter((e) => e.home_branch_id === branchId || shiftEmpIds.has(e.id))
      .map((e) => ({
        id: e.id,
        employee_code: e.employee_code,
        name: e.name,
        homeBranchCode: e.homeBranchCode,
        dispatched: e.home_branch_id !== branchId,
      }));
    const rosterIds = new Set(employees.map((e) => e.id));
    // Dispatchable = active therapists from other branches not already on the roster.
    dispatchable = allEmps
      .filter((e) => !rosterIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, employee_code: e.employee_code, homeBranchCode: e.homeBranchCode }));
  }

  return { branches: list, branchId, monday, days, employees, dispatchable, shifts, stations };
}

export default async function ShiftSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; week?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const view: ShiftView = sp.view === 'station' ? 'station' : 'employee';
  const { branches, branchId, monday, days, employees, dispatchable, shifts, stations } = await fetchData(sp.branch, sp.week);

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
            Week of {monday} · {view === 'station' ? 'stations × days · click a cell to assign a therapist' : 'home-branch + dispatched therapists · click a cell to set a shift'}
          </p>
        </div>
        {branchId && <ShiftControls branches={branches} branchId={branchId} weekStart={monday} view={view} />}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : view === 'employee' ? (
        <>
          <div className="flex justify-end">
            <DispatchTherapist branchId={branchId} days={days} dispatchable={dispatchable} />
          </div>
          {employees.length === 0 ? (
            <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
              No therapists rostered here yet. Use “Dispatch therapist” to bring one in from another branch, or set a home branch in Settings → Employees.
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
                        <div className="font-semibold text-sm flex items-center gap-1.5">
                          {e.name}
                          {e.dispatched && (
                            <Badge variant="secondary" className="font-bold text-[10px]">
                              {e.homeBranchCode ? `from ${e.homeBranchCode}` : 'dispatched'}
                            </Badge>
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
                            stations={stations}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
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
