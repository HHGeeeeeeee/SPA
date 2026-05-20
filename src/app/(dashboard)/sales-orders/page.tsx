import Link from 'next/link';
import { Plus, Receipt } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { NewOrderDialog } from '@/components/sales-orders/new-order-dialog';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  reserved: 'secondary',
  draft: 'secondary',
  open: 'default',
  in_service: 'default',
  completed: 'default',
  posting: 'secondary',
  paid: 'default',
  closed: 'secondary',
  void: 'destructive',
};

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

async function fetchData() {
  const supabase = createServiceClient();
  const [ordRes, brRes, srcRes, billRes] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        id, order_no, status, order_type, service_date, total_cents, paid_cents,
        branch:branches!orders_branch_id_fkey ( code ),
        order_customers ( id )
      `)
      .is('deleted_at', null)
      .order('service_date', { ascending: false })
      .order('order_no', { ascending: false })
      .limit(200),
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
    supabase
      .from('customer_sources')
      .select('id, code, name, default_billing_to_id')
      .eq('active', true)
      .order('code'),
    supabase.from('billing_destinations').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (ordRes.error) throw new Error(ordRes.error.message);
  if (brRes.error) throw new Error(brRes.error.message);
  if (srcRes.error) throw new Error(srcRes.error.message);
  if (billRes.error) throw new Error(billRes.error.message);
  return {
    orders: ordRes.data ?? [],
    branches: brRes.data ?? [],
    sources: srcRes.data ?? [],
    billingDestinations: billRes.data ?? [],
  };
}

export default async function SalesOrdersPage() {
  const { orders, branches, sources, billingDestinations } = await fetchData();
  const openCount = orders.filter((o) => !['closed', 'void'].includes(o.status)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Sales Orders</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {orders.length} shown · {openCount} open
          </p>
        </div>
        <NewOrderDialog
          branches={branches}
          sources={sources}
          billingDestinations={billingDestinations}
          trigger={
            <Button disabled={branches.length === 0}>
              <Plus className="size-4" />
              New Order
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Order No</TableHead>
              <TableHead className="w-20 font-bold">Branch</TableHead>
              <TableHead className="w-28 font-bold">Type</TableHead>
              <TableHead className="w-16 font-bold">PAX</TableHead>
              <TableHead className="w-32 font-bold">Service Date</TableHead>
              <TableHead className="w-32 font-bold">Total</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16">
                  <Receipt className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">
                    No sales orders yet. Click &ldquo;New Order&rdquo; to create the first draft.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => {
                const branch = Array.isArray(o.branch) ? o.branch[0] : o.branch;
                const pax = o.order_customers?.length ?? 0;
                return (
                  <TableRow key={o.id} className="cursor-pointer">
                    <TableCell className="font-mono font-bold">
                      <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">
                        {o.order_no}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono font-bold">{branch?.code ?? '—'}</TableCell>
                    <TableCell className="font-medium text-muted-foreground text-xs">
                      {o.order_type}
                    </TableCell>
                    <TableCell className="font-bold tabular">{pax}</TableCell>
                    <TableCell className="font-medium tabular">{o.service_date}</TableCell>
                    <TableCell className="font-bold tabular">{peso(o.total_cents)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[o.status] ?? 'secondary'} className="font-bold capitalize">
                        {o.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
