import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { DayOccupancy } from '@/lib/occupancy';
import { UtilizationChart } from '@/components/dashboard/utilization-chart';

function pct(x: number | null | undefined): string {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}
function hrs(x: number): string {
  return `${Math.round(x * 10) / 10}`;
}

export function DashboardUtilization({ occ }: { occ: DayOccupancy }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-[0.12em]">Utilization · Today</h3>
        {occ.computable ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-3xl font-extrabold tabular-nums ${occ.utilizationPct != null && occ.utilizationPct >= 0.85 ? 'text-primary' : 'text-foreground'}`}>{pct(occ.utilizationPct)}</span>
              <span className="text-sm font-medium text-muted-foreground tabular-nums">utilization ({hrs(occ.actualHours)} service hr)</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold tabular-nums text-foreground">{pct(occ.stationOccPct)}</span>
              <span className="text-sm font-medium text-muted-foreground tabular-nums">station ({occ.stationCount} st. - {hrs(occ.bedHours)} hr)</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold tabular-nums text-foreground">{pct(occ.therapistOccPct)}</span>
              <span className="text-sm font-medium text-muted-foreground tabular-nums">therapist ({occ.therapistCount} pax - {hrs(occ.therapistHours)} hr)</span>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm font-semibold text-muted-foreground">Unavailable — {occ.note}</p>
        )}
      </CardHeader>
      {occ.computable && occ.perHour.length > 0 && (
        <CardContent>
          {/* Legend */}
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-indigo-500/75" /> Station occ</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-teal-500/75" /> Therapist occ</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-amber-500" /> Utilization</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-muted-foreground/25" /> Revenue (hourly)</span>
          </div>
          <UtilizationChart perHour={occ.perHour} />
        </CardContent>
      )}
    </Card>
  );
}
