'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BarChart3, Play, Gauge } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { cn, formatPHP } from '@/lib/utils';
import {
  REVENUE_DIMENSIONS,
  SERVICE_LINE_STATUSES,
  DEFAULT_STATUSES,
  STATUS_LABELS,
  MEASURES,
  type ServiceLineStatus,
} from '@/app/(dashboard)/report-builder/dimensions';
import {
  generateRevenueReport,
  generateOccupancyReport,
  type RevenueRow,
  type OccupancyRow,
} from '@/app/(dashboard)/report-builder/actions';

interface Branch { id: string; code: string; name: string }

// Report 2 group-by options — the only dimensions an occupancy ratio can be
// sliced by (a denominator exists per date / per station branch).
const OCCUPANCY_GROUP_OPTIONS: { key: string; label: string }[] = [
  { key: 'service_date', label: 'Date' },
  { key: 'station_branch', label: 'Station Branch' },
];

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}
function hrs(v: number): string {
  return v.toFixed(1);
}

export function ReportBuilder({ branches }: { branches: Branch[] }) {
  const today = todayPHT();
  const monthStart = `${today.slice(0, 8)}01`;

  const [tab, setTab] = useState('revenue');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [branchIds, setBranchIds] = useState<string[]>(branches.map((b) => b.id));

  // Revenue controls
  const [dimensions, setDimensions] = useState<string[]>(['service_date']);
  const [statuses, setStatuses] = useState<ServiceLineStatus[]>(DEFAULT_STATUSES);
  const [settledOnly, setSettledOnly] = useState(false);

  // Occupancy controls
  const [occGroupBy, setOccGroupBy] = useState<string[]>(['service_date']);

  // Results (snapshot the grouping used, so columns match the data)
  const [revResult, setRevResult] = useState<{ dims: string[]; rows: RevenueRow[] } | null>(null);
  const [occResult, setOccResult] = useState<{ groupBy: string[]; rows: OccupancyRow[] } | null>(null);
  const [pending, start] = useTransition();

  function toggleBranch(id: string) {
    setBranchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }
  function toggleDim(key: string) {
    setDimensions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  function toggleStatus(s: ServiceLineStatus) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function toggleOccGroup(key: string) {
    setOccGroupBy((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function generate() {
    start(async () => {
      if (tab === 'revenue') {
        const r = await generateRevenueReport({ from, to, dimensions, statuses, branchIds, settledOnly });
        if (r.ok) setRevResult({ dims: [...dimensions], rows: r.rows });
        else toast.error(r.error);
      } else {
        const r = await generateOccupancyReport({ from, to, branchIds, groupBy: occGroupBy });
        if (r.ok) setOccResult({ groupBy: [...occGroupBy], rows: r.rows });
        else toast.error(r.error);
      }
    });
  }

  const dimLabel = (key: string) => REVENUE_DIMENSIONS.find((d) => d.key === key)?.label ?? key;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="size-6 text-primary" /> Report Builder
        </h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Pick a date range and group-by dimensions to build a custom summary.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="revenue"><BarChart3 className="size-4" /> Revenue</TabsTrigger>
          <TabsTrigger value="occupancy"><Gauge className="size-4" /> Occupancy</TabsTrigger>
        </TabsList>

        {/* Shared controls + per-tab pickers */}
        <Card className="mt-2">
          <CardContent className="flex flex-col gap-5 py-5">
            {/* Date range */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
              </div>
            </div>

            {/* Branch filter */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branches</Label>
              <div className="flex flex-wrap items-center gap-2">
                {branches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleBranch(b.id)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors',
                      branchIds.includes(b.id) ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {b.code}
                  </button>
                ))}
              </div>
            </div>

            <TabsContent value="revenue" className="flex flex-col gap-5">
              {/* Group-by dimensions */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Group By</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {REVENUE_DIMENSIONS.map((d) => {
                    const idx = dimensions.indexOf(d.key);
                    return (
                      <label
                        key={d.key}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                          idx >= 0 ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                        )}
                      >
                        <Checkbox checked={idx >= 0} onCheckedChange={() => toggleDim(d.key)} />
                        <span className="flex-1">{d.label}</span>
                        {idx >= 0 && <span className="text-xs font-bold text-primary">{idx + 1}</span>}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  No dimension selected → a single grand-total row. The number badge is the column order.
                </p>
              </div>

              {/* Status filter */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status filter</Label>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_LINE_STATUSES.map((s) => (
                    <label
                      key={s}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                        statuses.includes(s) ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                      )}
                    >
                      <Checkbox checked={statuses.includes(s)} onCheckedChange={() => toggleStatus(s)} />
                      {STATUS_LABELS[s]}
                    </label>
                  ))}
                </div>
              </div>

              {/* Commission settled-only */}
              <label className="flex w-fit items-center gap-2 text-sm font-semibold">
                <Switch checked={settledOnly} onCheckedChange={(v) => setSettledOnly(v)} />
                Commission: settled lines only
              </label>
            </TabsContent>

            <TabsContent value="occupancy" className="flex flex-col gap-4">
              {/* Group-by (constrained to date / station branch) */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Group By</Label>
                <div className="flex flex-wrap gap-2">
                  {OCCUPANCY_GROUP_OPTIONS.map((o) => (
                    <label
                      key={o.key}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                        occGroupBy.includes(o.key) ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                      )}
                    >
                      <Checkbox checked={occGroupBy.includes(o.key)} onCheckedChange={() => toggleOccGroup(o.key)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                Occupancy &amp; utilization are ratios against capacity (rostered therapist-hours, station-hours), so
                they only break down by date and station branch — not by service / source / category. Ratios over a
                range are summed numerator ÷ summed denominator, not averaged. <span className="font-semibold">RevPATH</span> =
                net revenue per available therapist-hour.
              </p>
            </TabsContent>

            <div>
              <Button onClick={generate} disabled={pending}>
                <Play className="size-4" /> {pending ? 'Generating…' : 'Generate Report'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Tabs>

      {/* Results */}
      {tab === 'revenue' && revResult && <RevenueTable dims={revResult.dims} rows={revResult.rows} dimLabel={dimLabel} />}
      {tab === 'occupancy' && occResult && <OccupancyTable groupBy={occResult.groupBy} rows={occResult.rows} />}
    </div>
  );
}

function RevenueTable({ dims, rows, dimLabel }: { dims: string[]; rows: RevenueRow[]; dimLabel: (k: string) => string }) {
  const totals = MEASURES.reduce<Record<string, number>>((acc, m) => {
    acc[m.key] = rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0);
    return acc;
  }, {});

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <h3 className="text-base font-bold">Result</h3>
        <span className="ml-auto text-sm font-semibold text-muted-foreground">{rows.length} row(s)</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {dims.map((d) => <TableHead key={d}>{dimLabel(d)}</TableHead>)}
            {MEASURES.map((m) => <TableHead key={m.key} className="text-right">{m.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={dims.length + MEASURES.length} className="text-center text-muted-foreground py-6">No data for this selection.</TableCell></TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={i}>
                {dims.map((d) => (
                  <TableCell key={d} className="font-semibold">
                    {r[d] == null || r[d] === '' ? <span className="text-muted-foreground">Unassigned</span> : String(r[d])}
                  </TableCell>
                ))}
                {MEASURES.map((m) => (
                  <TableCell key={m.key} className="text-right tabular-nums">
                    {m.money ? formatPHP(Number(r[m.key])) : Number(r[m.key]).toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={dims.length} className="font-extrabold">Total</TableCell>
              {MEASURES.map((m) => (
                <TableCell key={m.key} className="text-right font-extrabold tabular-nums">
                  {m.money ? formatPHP(totals[m.key]) : totals[m.key].toLocaleString()}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </Card>
  );
}

function OccupancyTable({ groupBy, rows }: { groupBy: string[]; rows: OccupancyRow[] }) {
  const showDate = groupBy.includes('service_date');
  const showBranch = groupBy.includes('station_branch');
  const OCC_COLS = 9; // occupancy metric columns spanned by the "not computable" note

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <h3 className="text-base font-bold">Occupancy</h3>
        <span className="ml-auto text-sm font-semibold text-muted-foreground">{rows.length} row(s)</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {showDate && <TableHead>Date</TableHead>}
            {showBranch && <TableHead>Station Branch</TableHead>}
            <TableHead className="text-right">Utilization</TableHead>
            <TableHead className="text-right">Station Occ</TableHead>
            <TableHead className="text-right">Therapist Occ</TableHead>
            <TableHead className="text-right">Capacity hrs</TableHead>
            <TableHead className="text-right">Therapist hrs</TableHead>
            <TableHead className="text-right">Actual hrs</TableHead>
            <TableHead className="text-right">Stations</TableHead>
            <TableHead className="text-right">Therapists</TableHead>
            <TableHead className="text-right">Absent hrs</TableHead>
            <TableHead className="text-right">RevPATH</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">Discount</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Net of Comm.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={(showDate ? 1 : 0) + (showBranch ? 1 : 0) + OCC_COLS + 6} className="text-center text-muted-foreground py-6">No data for this selection.</TableCell></TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={i}>
                {showDate && <TableCell className="font-semibold">{r.date ?? '—'}</TableCell>}
                {showBranch && <TableCell className="font-semibold">{r.branchLabel ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>}
                {r.computable ? (
                  <>
                    <TableCell className="text-right tabular-nums font-bold">{pct(r.utilizationPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.stationOccPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.therapistOccPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hrs(r.capacityHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hrs(r.therapistHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hrs(r.actualHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.stationCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.therapistCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{hrs(r.absentHours)}</TableCell>
                  </>
                ) : (
                  <TableCell colSpan={OCC_COLS} className="text-muted-foreground">{r.note ?? 'not computable'}</TableCell>
                )}
                <TableCell className="text-right tabular-nums font-bold">{r.revpathCents == null ? '—' : formatPHP(r.revpathCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPHP(r.sales_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPHP(r.discount_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPHP(r.net_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPHP(r.commission_cents)}</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{formatPHP(r.net_of_commission_cents)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}