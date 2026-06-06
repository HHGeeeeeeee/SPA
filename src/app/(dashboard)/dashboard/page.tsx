import { createServiceClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadReconStatus } from '@/lib/recon-status';
import { OverdueCloseBanner } from '@/components/reconciliation/overdue-close-banner';
import { DashboardBranchPicker } from '@/components/dashboard/dashboard-branch-picker';
import { DashboardUtilization } from '@/components/dashboard/dashboard-utilization';
import { computeDayOccupancy } from '@/lib/occupancy';
import { getAllowedBranchIds } from '@/lib/branch-access';

export const dynamic = 'force-dynamic';

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
    .select('id, total_cents, discount_cents, status, order_customers ( id )')
    .eq('service_date', today)
    .is('deleted_at', null)
    .neq('status', 'void')
    .in('branch_id', branchIds);

  const orders = todayOrders ?? [];
  const bookings = orders.length;
  const pax = orders.reduce((s, o) => s + (o.order_customers?.length ?? 0), 0);
  const revenue = orders.filter((o) => o.status === 'closed').reduce((s, o) => s + o.total_cents, 0);
  const discount = orders.reduce((s, o) => s + o.discount_cents, 0);

  return { today, bookings, pax, revenue, discount };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const { branches, selected } = await fetchBranches(sp.branch);
  const [d, recon, occ] = await Promise.all([
    fetchData(selected),
    loadReconStatus(),
    computeDayOccupancy(selected, todayPHT(), new Date().toISOString()),
  ]);
  const overdueItems = recon.branches
    .filter((b) => b.overdueClose)
    .map((b) => ({
      branch_id: b.id,
      branch_code: b.code,
      business_date: b.overdueClose!.business_date,
      days_overdue: b.overdueClose!.days_overdue,
    }));

  const kpis = [
    { label: 'Bookings Today', value: String(d.bookings) },
    { label: 'Guests Today', value: String(d.pax) },
    { label: 'Revenue Today', value: peso(d.revenue) },
    { label: 'Discount Today', value: peso(d.discount) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <DashboardBranchPicker branches={branches} selected={selected} />

      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">Today · {d.today}</p>
      </div>

      <OverdueCloseBanner items={overdueItems} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold tracking-tight tabular">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DashboardUtilization occ={occ} />
    </div>
  );
}
