import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderWorkspace } from '@/components/sales-orders/order-workspace';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', open: 'default', in_service: 'default', completed: 'default',
  paid: 'default', closed: 'secondary', void: 'destructive',
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchData(id: string) {
  const supabase = createServiceClient();
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, order_no, status, order_type, service_date, note, branch_id,
      subtotal_cents, discount_cents, total_cents, paid_cents,
      branch:branches!orders_branch_id_fkey ( code, name ),
      source:customer_sources ( code, name ),
      billing:billing_destinations!orders_billing_to_id_fkey ( code, name ),
      order_customers ( id, customer_name, customer_phone, seq_no ),
      order_items (
        id, order_customer_id, list_price_cents, discount_amount_cents, final_amount_cents,
        service:service_items ( name ),
        therapist:employees ( name )
      )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  const [svc, emp, res, disc, pm] = await Promise.all([
    supabase.from('service_items').select('id, code, name').eq('active', true).order('code'),
    supabase.from('employees').select('id, employee_code, name').eq('status', 'active').order('employee_code'),
    supabase.from('resources').select('id, resource_name').eq('branch_id', order.branch_id).eq('status', 'active').order('resource_name'),
    supabase.from('discount_classes').select('id, code, description').eq('active', true).order('code'),
    supabase.from('payment_methods').select('id, code, display_name').eq('active', true).order('code'),
  ]);

  return {
    order,
    serviceItems: (svc.data ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name })),
    employees: (emp.data ?? []).map((e) => ({ id: e.id, code: e.employee_code, name: e.name })),
    resources: (res.data ?? []).map((r) => ({ id: r.id, code: '', name: r.resource_name })),
    discountClasses: disc.data ?? [],
    paymentMethods: pm.data ?? [],
  };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await fetchData(id);
  if (!result) notFound();
  const { order, serviceItems, employees, resources, discountClasses, paymentMethods } = result;

  const branch = one(order.branch);
  const source = one(order.source);
  const billing = one(order.billing);

  const customers = (order.order_customers ?? []).map((c) => ({
    id: c.id, customer_name: c.customer_name, customer_phone: c.customer_phone, seq_no: c.seq_no,
  }));
  const items = (order.order_items ?? []).map((it) => {
    const svc = one(it.service);
    const th = one(it.therapist);
    return {
      id: it.id,
      order_customer_id: it.order_customer_id,
      service_name: svc?.name ?? 'Service',
      therapist_name: th?.name ?? null,
      list_price_cents: it.list_price_cents,
      discount_amount_cents: it.discount_amount_cents,
      final_amount_cents: it.final_amount_cents,
    };
  });

  const editable = ['draft', 'open', 'in_service'].includes(order.status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/sales-orders" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Sales Orders
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h2 className="text-3xl font-bold tracking-tight font-mono">{order.order_no}</h2>
          <Badge variant={STATUS_VARIANT[order.status] ?? 'secondary'} className="font-bold capitalize">
            {order.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold">Order Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Branch</dt>
                <dd className="font-semibold mt-0.5">{branch ? `${branch.code} — ${branch.name}` : '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</dt>
                <dd className="font-semibold mt-0.5 capitalize">{order.order_type.replace('_', ' ')}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Service Date</dt>
                <dd className="font-semibold mt-0.5 tabular">{order.service_date}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Customer Source</dt>
                <dd className="font-semibold mt-0.5">{source ? `${source.code} — ${source.name}` : '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Billing To</dt>
                <dd className="font-semibold mt-0.5">{billing ? `${billing.code} — ${billing.name}` : 'Self-pay'}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Note</dt>
                <dd className="font-medium mt-0.5 text-muted-foreground">{order.note ?? '—'}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold">Totals</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Subtotal</dt><dd className="font-bold tabular">{peso(order.subtotal_cents)}</dd></div>
              <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Discount</dt><dd className="font-bold tabular text-destructive">-{peso(order.discount_cents)}</dd></div>
              <div className="flex justify-between border-t border-border pt-2"><dt className="font-bold">Total</dt><dd className="font-extrabold tabular text-lg">{peso(order.total_cents)}</dd></div>
              <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Paid</dt><dd className="font-bold tabular">{peso(order.paid_cents)}</dd></div>
              <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Due</dt><dd className="font-bold tabular">{peso(Math.max(0, order.total_cents - order.paid_cents))}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <OrderWorkspace
        order={{
          id: order.id,
          status: order.status,
          total_cents: order.total_cents,
          paid_cents: order.paid_cents,
          editable,
        }}
        customers={customers}
        items={items}
        serviceItems={serviceItems}
        employees={employees}
        resources={resources}
        discountClasses={discountClasses}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}
