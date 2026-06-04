import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { NewOrderButton } from '@/components/sales-orders/new-order-button';
import { OrdersExplorer, type OrderRow } from '@/components/sales-orders/orders-explorer';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [ordRes, brRes, srcRes, billRes, arRes] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        id, order_no, status, order_type, service_date, total_cents, paid_cents,
        branch:branches!orders_branch_id_fkey ( code ),
        billing:billing_destinations!orders_billing_to_id_fkey ( code, default_payment_method_id ),
        source:customer_sources ( name ),
        order_customers ( customer_name, seq_no ),
        payments ( tips ( amount_cents ) )
      `)
      .is('deleted_at', null)
      .order('service_date', { ascending: false })
      .order('order_no', { ascending: false })
      .limit(500),
    supabase
      .from('branches')
      .select(`
        id, code, name,
        branch_business_units ( business_units ( id, code, name ) )
      `)
      .eq('active', true)
      .order('code'),
    supabase
      .from('customer_sources')
      .select('id, code, name, default_billing_to_id')
      .eq('active', true)
      .order('code'),
    supabase.from('billing_destinations').select('id, code, name').eq('active', true).order('code'),
    supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle(),
  ]);
  if (ordRes.error) throw new Error(ordRes.error.message);
  if (brRes.error) throw new Error(brRes.error.message);
  if (srcRes.error) throw new Error(srcRes.error.message);
  if (billRes.error) throw new Error(billRes.error.message);
  const allowed = await getAllowedBranchIds();
  const branches = (brRes.data ?? []).filter((b) => allowed.has(b.id)).map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    businessUnits: (b.branch_business_units ?? [])
      .map((row) => (Array.isArray(row.business_units) ? row.business_units[0] : row.business_units))
      .filter(Boolean) as { id: string; code: string; name: string }[],
  }));

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const arMethodId = arRes.data?.id ?? null;
  const rows: OrderRow[] = (ordRes.data ?? []).map((o) => {
    const billing = one(o.billing);
    // AR-billed orders carry no counter payment — the whole total is on AR terms.
    const isAR = !!arMethodId && billing?.default_payment_method_id === arMethodId;
    const custs = o.order_customers ?? [];
    // Main guest = lowest seq_no (the primary booker, #1).
    const mainGuest = custs
      .slice()
      .sort((a, b) => (a.seq_no ?? 0) - (b.seq_no ?? 0))[0]?.customer_name ?? null;
    return {
      id: o.id,
      order_no: o.order_no,
      status: o.status,
      order_type: o.order_type,
      service_date: o.service_date,
      total_cents: o.total_cents,
      paid_cents: o.paid_cents,
      is_ar: isAR,
      branch_code: one(o.branch)?.code ?? '—',
      billing_code: billing?.code ?? null,
      source_name: one(o.source)?.name ?? null,
      guest_name: mainGuest,
      pax: custs.length,
      tip_cents: (o.payments ?? []).reduce((s, p) => s + (p.tips ?? []).reduce((a, t) => a + t.amount_cents, 0), 0),
    };
  });

  return {
    rows,
    branches,
    sources: srcRes.data ?? [],
    billingDestinations: billRes.data ?? [],
  };
}

export default async function SalesOrdersPage() {
  const { rows, branches, billingDestinations } = await fetchData();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Sales Orders</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {rows.length} order{rows.length === 1 ? '' : 's'} · filter by branch / date / billing / status / payment
          </p>
        </div>
        <NewOrderButton disabled={branches.length === 0} />
      </div>

      <OrdersExplorer
        rows={rows}
        branchCodes={branches.map((b) => b.code)}
        billingCodes={billingDestinations.map((b) => b.code)}
      />
    </div>
  );
}
