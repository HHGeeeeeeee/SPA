import Link from 'next/link';

import { createServiceClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadReconStatus } from '@/lib/recon-status';
import { OverdueCloseBanner } from '@/components/reconciliation/overdue-close-banner';
import { DashboardBranchPicker } from '@/components/dashboard/dashboard-branch-picker';
import { DashboardUtilization } from '@/components/dashboard/dashboard-utilization';
import { DashboardCommission, type CommRow } from '@/components/dashboard/dashboard-commission';
import { PrintButton } from '@/components/system-compare/print-button';
import { computeDayOccupancy } from '@/lib/occupancy';
import { loadCommissionGroups } from '@/app/(dashboard)/reconciliation/commission/actions';
import { getAllowedBranchIds } from '@/lib/branch-access';

export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 0 });
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// Active branches the viewer may see, plus the resolved selection from the
// `branch` URL param (comma-separated). Defaults to all allowed branches.
async function fetchBranches(branchParam?: string): Promise<{ branches: { id: string; code: string; name: string }[]; selected: string[] }> {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  const { data } = await supabase.from('branches').select('id, code, name').eq('active', true).order('code');
  const list = (data ?? []).filter((b) => allowed.has(b.id));
  const requested = (branchParam ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const valid = requested.filter((id) => list.some((b) => b.id === id));
  const selected = valid.length ? valid : list.map((b) => b.id);
  return { branches: list, selected };
}

async function fetchData(branchIds: string[]) {
  const supabase = createServiceClient();
  const today = todayPHT();

  const { data: todayOrders } = await supabase
    .from('orders')
    .select('id, subtotal_cents, discount_cents, status, order_customers ( id ), order_items ( status, duration_minutes )')
    .eq('service_date', today)
    .is('deleted_at', null)
    .neq('status', 'void')
    .in('branch_id', branchIds);

  const orders = todayOrders ?? [];
  // Footfall = every guest on the day (any status). Financial figures are on the
  // closed-order basis (matches the commission engine, which only counts closed
  // orders) so Net = Revenue − Discount − Commission stays coherent. Revenue is
  // GROSS (subtotal, pre-discount) so the subtraction isn't double-counted.
  const pax = orders.reduce((s, o) => s + (o.order_customers?.length ?? 0), 0);
  const closed = orders.filter((o) => o.status === 'closed');
  const revenue = closed.reduce((s, o) => s + (o.subtotal_cents ?? 0), 0);
  const discount = closed.reduce((s, o) => s + (o.discount_cents ?? 0), 0);
  // Delivered services today (operational — all activity, not just closed).
  let serviceCount = 0;
  let serviceMinutes = 0;
  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      if (it.status === 'service_completed') { serviceCount += 1; serviceMinutes += it.duration_minutes ?? 0; }
    }
  }

  return { today, pax, revenue, discount, serviceCount, serviceHours: serviceMinutes / 60 };
}

// Simulated commission for today across the selected branches — reuses the
// settlement engine (closed orders, completed services, current rates + warm-up),
// merged per therapist for the ranking.
interface OpenShiftRow {
  id: string;
  branchCode: string;
  businessDate: string;
  label: string;
  openedByName: string | null;
}
// Sales-remittance shifts still open (not yet counted & closed) across the
// selected branches — oldest first so a long-overdue open shift surfaces on top.
async function fetchOpenShifts(branchIds: string[]): Promise<OpenShiftRow[]> {
  if (branchIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shifts')
    .select('id, business_date, label, opened_at, opener:staff_users!shifts_opened_by_fkey ( display_name, email ), branch:branches!shifts_branch_id_fkey ( code )')
    .in('branch_id', branchIds)
    .eq('status', 'open')
    .order('business_date', { ascending: true })
    .order('opened_at', { ascending: true });
  return (data ?? []).map((r) => {
    const opener = one(r.opener);
    return {
      id: r.id,
      branchCode: one(r.branch)?.code ?? '—',
      businessDate: r.business_date,
      label: r.label,
      openedByName: opener?.display_name ?? opener?.email ?? null,
    };
  });
}

async function fetchCommission(branchIds: string[], today: string): Promise<{ total: number; top: CommRow[] }> {
  const perBranch = await Promise.all(branchIds.map((b) => loadCommissionGroups(b, today, today)));
  const byTherapist = new Map<string, CommRow>();
  for (const groups of perBranch) {
    for (const g of groups) {
      const minutes = g.items.reduce((s, it) => s + (it.duration_minutes ?? 0), 0);
      const prev = byTherapist.get(g.therapist_id);
      if (prev) {
        prev.sessions += g.sessions;
        prev.minutes += minutes;
        prev.grossCents += g.gross_cents;
        prev.commissionCents += g.commission_cents;
        prev.borrowedFrom = prev.borrowedFrom ?? g.borrowed_from;
      } else {
        byTherapist.set(g.therapist_id, {
          therapistId: g.therapist_id, name: g.therapist_name, sessions: g.sessions, minutes,
          grossCents: g.gross_cents, commissionCents: g.commission_cents, borrowedFrom: g.borrowed_from,
        });
      }
    }
  }
  const ranked = [...byTherapist.values()].sort((a, b) => b.commissionCents - a.commissionCents);
  return { total: ranked.reduce((s, g) => s + g.commissionCents, 0), top: ranked.slice(0, 10) };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const { branches, selected } = await fetchBranches(sp.branch);
  const today = todayPHT();
  const [d, recon, occ, comm, openShifts] = await Promise.all([
    fetchData(selected),
    loadReconStatus(),
    computeDayOccupancy(selected, today, new Date().toISOString()),
    fetchCommission(selected, today),
    fetchOpenShifts(selected),
  ]);
  const overdueItems = recon.branches
    .filter((b) => b.overdueClose)
    .map((b) => ({
      branch_id: b.id,
      branch_code: b.code,
      business_date: b.overdueClose!.business_date,
      days_overdue: b.overdueClose!.days_overdue,
    }));

  const net = d.revenue - d.discount - comm.total;

  return (
    <div className="flex flex-col gap-6">
      <DashboardBranchPicker branches={branches} selected={selected} />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">Today · {d.today}</p>
        </div>
        <PrintButton />
      </div>

      <div className="print:hidden">
        <OverdueCloseBanner items={overdueItems} />
      </div>

      {/* One KPI row: the Revenue − Discount − Commission = Net waterfall (double
          wide), then guests + services delivered + open sales-remittance shifts. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">( Revenue − Discount ) − Commission = Net</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-4xl font-extrabold tracking-tight tabular-nums">
              <span className="text-2xl font-bold text-muted-foreground">(</span>
              <span>{peso(d.revenue)}</span>
              <span className="text-2xl font-bold text-muted-foreground">−</span>
              <span>{peso(d.discount)}</span>
              <span className="text-2xl font-bold text-muted-foreground">)</span>
              <span className="text-2xl font-bold text-muted-foreground">−</span>
              <span>{peso(comm.total)}</span>
              <span className="text-2xl font-bold text-muted-foreground">=</span>
              <span className={net < 0 ? 'text-destructive' : 'text-primary'}>{peso(net)}</span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">Gross revenue · closed orders today; commission simulated</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">Guests Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold tracking-tight tabular">{d.pax}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">Service Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold tracking-tight tabular">{d.serviceCount}</div>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">{d.serviceHours.toFixed(1)} service hr</p>
          </CardContent>
        </Card>

        {/* Open sales-remittance shifts: how many drawers are still un-counted,
            and which shift / who opened it (links to the remittance detail). */}
        <Card className={openShifts.length ? 'border-primary/40' : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">Open Sales Remittance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-extrabold tracking-tight tabular ${openShifts.length ? 'text-primary' : ''}`}>{openShifts.length}</div>
            {openShifts.length === 0 ? (
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">All shifts closed</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {openShifts.map((s) => (
                  <li key={s.id} className="text-xs leading-tight">
                    <Link href={`/reconciliation/shift-remittance/${s.id}`} className="font-bold underline underline-offset-2">
                      {s.branchCode} · {s.businessDate} · {s.label}
                    </Link>
                    <span className="block font-medium text-muted-foreground">by {s.openedByName ?? 'Unknown'}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DashboardCommission rows={comm.top} />

      <DashboardUtilization occ={occ} />
    </div>
  );
}
