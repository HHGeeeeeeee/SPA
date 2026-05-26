import Link from 'next/link';
import { UserCheck, Clock, Coffee, CircleAlert } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function hm(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
}
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchData(branchParam?: string) {
  const supabase = createServiceClient();
  const branches = await getAllowedBranches();
  const list = branches ?? [];
  const branchId = branchParam && list.some((b) => b.id === branchParam) ? branchParam : list[0]?.id;
  const today = todayPHT();

  if (!branchId) return { branches: list, branchId: undefined, rows: [], today };

  const [shiftRes, attRes, busyRes] = await Promise.all([
    supabase
      .from('employee_shifts')
      .select('employee_id, shift_type, shift_start, shift_end, employees:employee_id ( employee_code, name )')
      .eq('branch_id', branchId)
      .eq('shift_date', today)
      .in('shift_type', ['regular', 'cross_branch', 'on_call']),
    supabase
      .from('employee_attendance')
      .select('employee_id, clock_in_at, clock_out_at, status')
      .eq('branch_id', branchId)
      .gte('clock_in_at', `${today}T00:00:00`)
      .lte('clock_in_at', `${today}T23:59:59`),
    supabase
      .from('order_items')
      .select('therapist_id, actual_start, duration_minutes, service:service_items ( name )')
      .eq('status', 'in_service')
      .not('therapist_id', 'is', null),
  ]);

  const attByEmp = new Map((attRes.data ?? []).map((a) => [a.employee_id, a]));
  const busyByEmp = new Map(
    (busyRes.data ?? []).map((b) => [b.therapist_id as string, b]),
  );

  const rows = (shiftRes.data ?? []).map((sh) => {
    const emp = one(sh.employees);
    const att = attByEmp.get(sh.employee_id);
    const busy = busyByEmp.get(sh.employee_id);
    const clockedIn = !!att && !att.clock_out_at;
    let state: 'in_service' | 'available' | 'not_in';
    if (busy) state = 'in_service';
    else if (clockedIn) state = 'available';
    else state = 'not_in';
    const expectedEnd = busy?.actual_start
      ? new Date(Date.parse(busy.actual_start) + (busy.duration_minutes ?? 60) * 60000).toISOString()
      : null;
    return {
      id: sh.employee_id,
      code: emp?.employee_code ?? '',
      name: emp?.name ?? '—',
      shiftType: sh.shift_type,
      shiftWindow: sh.shift_start ? `${sh.shift_start.slice(0, 5)}–${(sh.shift_end ?? '').slice(0, 5)}` : 'on-call',
      state,
      clockInAt: att?.clock_in_at ?? null,
      lateOrStatus: att?.status ?? null,
      serviceName: busy ? one(busy.service)?.name ?? 'Service' : null,
      since: busy?.actual_start ? hm(busy.actual_start) : null,
      until: expectedEnd ? hm(expectedEnd) : null,
    };
  });

  return { branches: list, branchId, rows, today };
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const sp = await searchParams;
  const { branches, branchId, rows, today } = await fetchData(sp.branch);

  const available = rows.filter((r) => r.state === 'available').length;
  const inService = rows.filter((r) => r.state === 'in_service').length;
  const notIn = rows.filter((r) => r.state === 'not_in').length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Therapist Availability</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Live · {today} · scheduled ∩ clocked-in ∩ not mid-service
        </p>
      </div>

      {branches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/availability?branch=${b.id}`}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors',
                b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {b.code}
            </Link>
          ))}
        </div>
      )}

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          Create a branch first.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Available now</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-extrabold tabular text-primary">{available}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">In service</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-extrabold tabular text-blue-600 dark:text-blue-400">{inService}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Not clocked in</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-extrabold tabular text-muted-foreground">{notIn}</div></CardContent>
            </Card>
          </div>

          {rows.length === 0 ? (
            <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
              No therapists scheduled at this branch today. Set shifts in Shift Schedule.
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map((r) => (
                <Card key={r.id} className={cn(
                  r.state === 'available' && 'ring-1 ring-primary/30',
                  r.state === 'in_service' && 'ring-1 ring-blue-500/30',
                )}>
                  <CardContent className="py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{r.name}</span>
                        <span className="font-mono font-bold text-xs text-muted-foreground">{r.code}</span>
                        {r.shiftType === 'cross_branch' && <Badge variant="secondary" className="font-bold text-[10px]">cross</Badge>}
                      </div>
                      {r.state === 'in_service' ? (
                        <p className="text-sm font-medium text-muted-foreground mt-0.5">
                          {r.serviceName} · since {r.since}{r.until && ` · ~ends ${r.until}`}
                        </p>
                      ) : r.state === 'available' ? (
                        <p className="text-sm font-medium text-muted-foreground mt-0.5">
                          Clocked in {r.clockInAt ? hm(r.clockInAt) : ''} · shift {r.shiftWindow}
                        </p>
                      ) : (
                        <p className="text-sm font-medium text-muted-foreground mt-0.5">
                          Scheduled {r.shiftWindow} · not clocked in
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {r.state === 'available' && (
                        <Badge className="font-bold gap-1"><UserCheck className="size-3" /> Available</Badge>
                      )}
                      {r.state === 'in_service' && (
                        <Badge variant="secondary" className="font-bold gap-1 text-blue-700 dark:text-blue-400"><Clock className="size-3" /> In service</Badge>
                      )}
                      {r.state === 'not_in' && (
                        <Badge variant="secondary" className="font-bold gap-1"><CircleAlert className="size-3" /> Not in</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <p className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
            <Coffee className="size-3" />
            Off-duty and on-leave therapists are not shown. Clock-in comes from the (future) biometric feed; seeded data shown for now.
          </p>
        </>
      )}
    </div>
  );
}
