import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Users, ScrollText } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary',
  open: 'default',
  in_service: 'default',
  completed: 'default',
  paid: 'default',
  closed: 'secondary',
  void: 'destructive',
};

async function fetchOrder(id: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_no, status, order_type, service_date, note,
      subtotal_cents, discount_cents, total_cents, paid_cents,
      branch:branches!orders_branch_id_fkey ( code, name ),
      source:customer_sources ( code, name ),
      billing:billing_destinations!orders_billing_to_id_fkey ( code, name ),
      order_customers ( id, customer_name, customer_phone, seq_no ),
      order_items ( id, final_amount_cents, status )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await fetchOrder(id);
  if (!order) notFound();

  const branch = one(order.branch);
  const source = one(order.source);
  const billing = one(order.billing);
  const customers = order.order_customers ?? [];
  const items = order.order_items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/sales-orders"
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
          Sales Orders
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
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Order Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Branch</dt>
                <dd className="font-semibold mt-0.5">{branch ? `${branch.code} — ${branch.name}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</dt>
                <dd className="font-semibold mt-0.5 capitalize">{order.order_type.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Service Date</dt>
                <dd className="font-semibold mt-0.5 tabular">{order.service_date}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Customer Source</dt>
                <dd className="font-semibold mt-0.5">{source ? `${source.code} — ${source.name}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Billing To</dt>
                <dd className="font-semibold mt-0.5">{billing ? `${billing.code} — ${billing.name}` : 'Self-pay'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Note</dt>
                <dd className="font-medium mt-0.5 text-muted-foreground">{order.note ?? '—'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="font-medium text-muted-foreground">Subtotal</dt>
                <dd className="font-bold tabular">{peso(order.subtotal_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-muted-foreground">Discount</dt>
                <dd className="font-bold tabular text-destructive">-{peso(order.discount_cents)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="font-bold">Total</dt>
                <dd className="font-extrabold tabular text-lg">{peso(order.total_cents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-muted-foreground">Paid</dt>
                <dd className="font-bold tabular">{peso(order.paid_cents)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Users className="size-4" /> Customers ({customers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground">
              No customers added yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {customers
                .sort((a, b) => a.seq_no - b.seq_no)
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-semibold">#{c.seq_no} · {c.customer_name}</span>
                    <span className="font-medium text-muted-foreground">{c.customer_phone ?? '—'}</span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <ScrollText className="size-4" /> Service Items ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground">
              No service items yet. The line-item editor (services, therapist, station,
              discount, scheduling) is the next module to be built.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium capitalize">{it.status.replace('_', ' ')}</span>
                  <span className="font-bold tabular">{peso(it.final_amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
