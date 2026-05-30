import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, CalendarClock } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MarkFulfilledButton } from '@/components/sales-orders/mark-fulfilled-button';

export const dynamic = 'force-dynamic';

interface PendingItem {
  id: string;
  order_id: string;
  order_no: number;
  service_date: string;
  branch_code: string;
  customer_name: string | null;
  service_name: string;
  interrupted_at: string;
  reason_label: string | null;
  notes: string | null;
}

async function fetchPending(): Promise<PendingItem[]> {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  // Reschedule ledger — every interrupted service marked 'reschedule' that
  // hasn't been cleared. Branch-scoped: a manager only sees pending
  // reschedules for the branches they have access to.
  const q = supabase
    .from('order_items')
    .select(`
      id, interruption_at, interruption_reason, interruption_notes,
      service:service_items ( name ),
      order:orders!order_items_order_id_fkey ( id, order_no, service_date, branch_id, branch:branches!orders_branch_id_fkey ( code ) ),
      customer:order_customers!order_items_order_customer_id_fkey ( customer_name )
    `)
    .eq('interruption_handling', 'reschedule')
    .is('reschedule_fulfilled_at', null)
    .in('order.branch_id', [...allowed])
    .order('interruption_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const svc = Array.isArray(row.service) ? row.service[0] : row.service;
    const ord = Array.isArray(row.order) ? row.order[0] : row.order;
    const br = Array.isArray(ord?.branch) ? ord?.branch[0] : ord?.branch;
    const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    return {
      id: row.id,
      order_id: ord?.id ?? '',
      order_no: ord?.order_no ?? 0,
      service_date: ord?.service_date ?? '',
      branch_code: br?.code ?? '—',
      customer_name: cust?.customer_name ?? null,
      service_name: svc?.name ?? '—',
      interrupted_at: row.interruption_at ?? '',
      reason_label: row.interruption_reason,
      notes: row.interruption_notes,
    };
  });
}

function daysAgo(iso: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
}

export default async function PendingReschedulesPage() {
  if (!isManager(await currentSession())) redirect('/dashboard');
  const items = await fetchPending();

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
        <h2 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
          <CalendarClock className="size-7 text-primary" />
          Pending Reschedules
        </h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Interrupted services marked for reschedule that the guest hasn’t come back to redo yet.
          Mark fulfilled once the make-up service is rendered (or the request is abandoned).
        </p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Order</TableHead>
              <TableHead className="font-bold">Branch</TableHead>
              <TableHead className="font-bold">Guest</TableHead>
              <TableHead className="font-bold">Service</TableHead>
              <TableHead className="font-bold">Reason</TableHead>
              <TableHead className="font-bold">Interrupted</TableHead>
              <TableHead className="font-bold">Pending</TableHead>
              <TableHead className="w-32 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No pending reschedules. ✓
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((it) => {
                const days = daysAgo(it.interrupted_at);
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-bold">
                      <Link className="hover:text-primary" href={`/sales-orders/${it.order_id}`}>
                        #{it.order_no}
                      </Link>
                      <div className="text-xs font-medium text-muted-foreground">{it.service_date}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-bold font-mono text-xs uppercase">
                        {it.branch_code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {it.customer_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-semibold">{it.service_name}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-sm">{it.reason_label ?? '—'}</div>
                      {it.notes && (
                        <div className="text-xs font-medium text-muted-foreground max-w-xs truncate" title={it.notes}>
                          {it.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-sm text-muted-foreground">
                      {it.interrupted_at
                        ? new Date(it.interrupted_at).toLocaleString('en-PH', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={days >= 14 ? 'destructive' : days >= 7 ? 'default' : 'secondary'}
                        className="font-bold"
                      >
                        {days}d
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <MarkFulfilledButton itemId={it.id} />
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
