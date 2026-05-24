import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { ArBalanceExplorer, type ArRow } from '@/components/reconciliation/ar-balance-explorer';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchData(): Promise<ArRow[]> {
  const supabase = createServiceClient();

  // "AR" = orders billed to a destination whose default payment method is AR
  // (intercompany hotels / third-party on AR terms) — self-pay is excluded.
  // Service-rendered orders sit at `completed` until collection closes them, so
  // both `completed` (awaiting collection) and `closed` count as live AR.
  const { data: arMethod } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arId = arMethod?.id ?? null;
  if (!arId) return [];

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id, order_no, service_date, total_cents,
      billing:billing_destinations!orders_billing_to_id_fkey ( id, code, name, settlement_type, default_payment_method_id )
    `)
    .in('status', ['completed', 'closed'])
    .not('billing_to_id', 'is', null)
    .is('deleted_at', null)
    .order('service_date', { ascending: true });
  if (error) throw new Error(error.message);

  const arOrders = (orders ?? []).filter((o) => one(o.billing)?.default_payment_method_id === arId);
  if (arOrders.length === 0) return [];

  // Outstanding is reconciled against the actual payment records, not a cached
  // field: outstanding = order total − Σ payments on that order.
  const ids = arOrders.map((o) => o.id);
  const { data: pays } = await supabase.from('payments').select('order_id, amount_cents').in('order_id', ids);
  const paidByOrder = new Map<string, number>();
  for (const p of pays ?? []) {
    if (!p.order_id) continue;
    paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) ?? 0) + (p.amount_cents ?? 0));
  }

  return arOrders
    .map((o) => {
      const b = one(o.billing)!;
      const outstanding = o.total_cents - (paidByOrder.get(o.id) ?? 0);
      return {
        id: o.id,
        order_no: o.order_no,
        service_date: o.service_date,
        outstanding,
        billing_id: b.id,
        billing_code: b.code,
        billing_name: b.name,
        settlement_type: b.settlement_type,
      };
    })
    .filter((r) => r.outstanding > 0);
}

export default async function ArBalancePage() {
  const rows = await fetchData();
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  const billingCount = new Set(rows.map((r) => r.billing_id)).size;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Reconciliation
        </Link>
        <h2 className="text-3xl font-bold tracking-tight mt-1">AR Balance</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          AR orders (billed on AR terms) awaiting collection, outstanding reconciled against payments · {billingCount} billing · {peso(total)}
        </p>
      </div>

      <ArBalanceExplorer rows={rows} />
    </div>
  );
}
