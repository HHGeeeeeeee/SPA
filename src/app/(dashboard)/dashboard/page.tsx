import Link from 'next/link';

import { createServiceClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadReconStatus } from '@/lib/recon-status';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function fetchData() {
  const supabase = createServiceClient();
  const today = todayPHT();

  const arMethod = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arId = arMethod.data?.id ?? null;

  const [todayOrders, inService, openTips, svc, arOrders] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total_cents, discount_cents, status, order_customers ( id )')
      .eq('service_date', today)
      .is('deleted_at', null)
      .neq('status', 'void'),
    supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('status', 'in_service'),
    supabase.from('tips').select('amount_cents').is('settlement_id', null).eq('status', 'open'),
    supabase.from('stored_value_cards').select('current_balance_cents').eq('status', 'active'),
    supabase.from('orders').select('total_cents').eq('status', 'closed').is('deleted_at', null),
  ]);

  const orders = todayOrders.data ?? [];
  const bookings = orders.length;
  const pax = orders.reduce((s, o) => s + (o.order_customers?.length ?? 0), 0);
  const revenue = orders.filter((o) => ['paid', 'closed'].includes(o.status)).reduce((s, o) => s + o.total_cents, 0);
  const discount = orders.reduce((s, o) => s + o.discount_cents, 0);
  const tipsOpen = (openTips.data ?? []).reduce((s, t) => s + t.amount_cents, 0);
  const svcLiability = (svc.data ?? []).reduce((s, c) => s + c.current_balance_cents, 0);

  // Outstanding AR = closed AR orders' totals (settled SOA reduction is a later refinement).
  const arOutstanding = arId
    ? (await supabase
        .from('orders')
        .select('total_cents, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
        .eq('status', 'closed')
        .is('deleted_at', null)).data
        ?.filter((o) => {
          const b = Array.isArray(o.billing) ? o.billing[0] : o.billing;
          return b?.default_payment_method_id === arId;
        })
        .reduce((s, o) => s + o.total_cents, 0) ?? 0
    : 0;

  return {
    today, bookings, pax, revenue, discount,
    inService: inService.count ?? 0,
    tipsOpen, svcLiability, arOutstanding,
    closedCount: (arOrders.data ?? []).length,
  };
}

export default async function DashboardPage() {
  const d = await fetchData();
  const recon = await loadReconStatus();

  const kpis = [
    { label: 'Bookings Today', value: String(d.bookings) },
    { label: 'Guests Today', value: String(d.pax) },
    { label: 'Revenue Today', value: peso(d.revenue) },
    { label: 'Discount Today', value: peso(d.discount) },
    { label: 'In Service Now', value: String(d.inService) },
  ];

  const finance = [
    { label: 'AR Outstanding', value: peso(d.arOutstanding), href: '/reconciliation/ar-balance' },
    { label: 'Tips Unsettled', value: peso(d.tipsOpen), href: '/reconciliation/tips' },
    { label: 'Stored-Value Liability', value: peso(d.svcLiability), href: '/stored-value-cards' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">Today · {d.today}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
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

      <div>
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-[0.12em] mb-2">Financial</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {finance.map((f) => (
            <Link key={f.label} href={f.href}>
              <Card className="transition-colors hover:bg-accent/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">{f.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-extrabold tracking-tight tabular">{f.value}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-[0.12em]">Daily Close · {recon.today}</h3>
          <Link href="/reconciliation" className="text-xs font-bold text-primary hover:underline">Reconciliation →</Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {recon.branches.map((b) => {
            const done = b.cashClosed && b.pendingConfirm === 0;
            return (
              <Link key={b.id} href={`/reconciliation/revenue-confirm?branch=${b.id}&date=${recon.today}`}>
                <Card className="transition-colors hover:bg-accent/40">
                  <CardHeader className="pb-2 flex-row items-center justify-between">
                    <CardTitle className="text-sm font-bold">{b.code}</CardTitle>
                    {done ? <span className="text-xs font-bold text-primary">All done</span> : <span className="size-2.5 rounded-full bg-amber-500" />}
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1 text-sm font-semibold">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Cash</span>
                      <span className={b.cashClosed ? 'text-primary' : 'text-amber-700 dark:text-amber-400'}>{b.cashClosed ? 'Closed' : 'Pending'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">To confirm</span>
                      <span className={`tabular ${b.pendingConfirm > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {b.pendingConfirm > 0 ? `${b.pendingConfirm} · ${peso(b.pendingConfirmCents)}` : '0'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
