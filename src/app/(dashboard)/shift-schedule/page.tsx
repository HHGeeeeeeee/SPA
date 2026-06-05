import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { type ShiftData } from '@/components/shift-schedule/shift-cell';
import { StaffWeekGrid } from '@/components/shift-schedule/staff-week-grid';
import { BulkShiftDialog } from '@/components/shift-schedule/bulk-shift-dialog';
import { RosterControls } from '@/components/shift-schedule/roster-controls';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { currentSession, isManager } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ShiftRow {
  employee_id: string;
  shift_date: string;
  shift_type: string;
  shift_start: string | null;
  shift_end: string | null;
  leave_type: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoUTC = (dt: Date) => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
// Monday of the current Manila week. Anchor "today" in PHT, then do the day math
// in UTC so midnight never drifts a day (the server may be in any timezone).
function thisMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back up to Monday (0 = Mon)
  return isoUTC(dt);
}
// The 7 day cells from `monday` (YYYY-MM-DD), in UTC so each date matches its
// Mon..Sun label exactly (no local-midnight → UTC roll-back).
function weekDays(monday: string): { date: string; label: string; dow: string }[] {
  const [y, m, d] = monday.split('-').map(Number);
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const out: { date: string; label: string; dow: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = isoUTC(new Date(Date.UTC(y, m - 1, d + i)));
    out.push({ date: iso, label: iso.slice(5), dow: dows[i] });
  }
  return out;
}
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Roster data for one branch + week: the branch's own (home-branch) therapists
// and their shifts for the week. The roster is home-branch only — cross-branch
// borrowing is arranged on the Calendar, not on this page. Position is joined so
// the grid can group rows by role.
async function fetchRoster(branchParam?: string, weekParam?: string) {
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
    const [emp, sh] = await Promise.all([
      supabase.from('employees').select('id, employee_code, name, home_branch_id, position:positions ( code )').eq('home_branch_id', branchId).eq('status', 'active').order('employee_code'),
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
  searchParams: Promise<{ branch?: string; week?: string }>;
}) {
  const sp = await searchParams;
  const { branches, branchId, monday, days, employees, shifts } = await fetchRoster(sp.branch, sp.week);
  // Editing the roster (set/clear/bulk shifts) is a manager task; everyone else
  // sees it read-only. Server actions enforce this too — this just hides the UI.
  const canManageRoster = isManager(await currentSession());

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
            Week of {monday} · home-branch therapists{canManageRoster ? ' · click a cell to set a shift' : ' · view only'}
          </p>
        </div>
        {branchId && <RosterControls branches={branches} branchId={branchId} weekStart={monday} />}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : employees.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          No active home-branch staff for this branch.
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