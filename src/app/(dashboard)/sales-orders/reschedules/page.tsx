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
import { RescheduleRowActions } from '@/components/sales-orders/reschedule-row-actions';

export const dynamic = 'force-dynamic';

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface PendingItem {
  id: string;
  order_id: string;
  order_no: number | string;
  service_date: string;
  branch_id: string;
  branch_code: string;
  source_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  service_name: string;
  service_item_id: string | null;
  service_category_id: string | null;
  interrupted_at: string;
  reason_label: string | null;
  notes: string | null;
}

async function fetchData() {
  const supabase = createServiceClient();
  const allowed = await getAllowedBranchIds();
  // Two queries in parallel: the pending reschedule rows themselves (filtered
  // by branch access) and the dropdown source data the NewReservationDialog
  // needs to render its pickers (branches / sources / categories / items).
  const [pendingRes, brRes, srcRes, catRes, siRes] = await Promise.all([
    supabase
      .from('order_items')
      .select(`
        id, service_item_id, interruption_at, interruption_reason, interruption_notes,
        service:service_items ( name, service_category_id ),
        order:orders!order_items_order_id_fkey (
          id, order_no, service_date, branch_id, source_id,
          branch:branches!orders_branch_id_fkey ( code )
        ),
        customer:order_customers!order_items_order_customer_id_fkey ( customer_name, customer_phone )
      `)
      .eq('interruption_handling', 'reschedule')
      .is('reschedule_fulfilled_at', null)
      .in('order.branch_id', [...allowed])
      .order('interruption_at', { ascending: false }),
    supabase
      .from('branches')
      .select('id, code, name, branch_business_units ( business_unit_id )')
      .eq('active', true)
      .eq('reservation_enabled', true)
      .order('code'),
    supabase.from('customer_sources').select('id, code, name, phone_required').eq('active', true).order('code'),
    supabase
      .from('service_categories')
      .select('id, code, name, required_resource_type, service_category_business_units ( business_unit_id )')
      .eq('active', true)
      .order('code'),
    supabase.from('service_items').select('id, name, service_group, service_category_id, duration_minutes').eq('active', true).order('service_group'),
  ]);
  if (pendingRes.error) throw new Error(pendingRes.error.message);
  if (brRes.error) throw new Error(brRes.error.message);
  if (srcRes.error) throw new Error(srcRes.error.message);
  if (catRes.error) throw new Error(catRes.error.message);

  const branches = (brRes.data ?? []).filter((b) => allowed.has(b.id)).map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    businessUnitIds: (b.branch_business_units ?? []).map((x) => x.business_unit_id),
  }));
  const serviceCategories = (catRes.data ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    businessUnitIds: (c.service_category_business_units ?? []).map((x) => x.business_unit_id),
    requiredResourceType: c.required_resource_type,
  }));
  const serviceItems = (siRes.data ?? [])
    .filter((s) => s.service_group)
    .map((s) => ({
      id: s.id,
      name: s.name,
      group: s.service_group as string,
      categoryId: s.service_category_id as string,
      durationMinutes: s.duration_minutes ?? null,
    }));

  const items: PendingItem[] = (pendingRes.data ?? []).map((row) => {
    const svc = one(row.service);
    const ord = one(row.order);
    const br = one(ord?.branch ?? null);
    const cust = one(row.customer);
    return {
      id: row.id,
      order_id: ord?.id ?? '',
      order_no: ord?.order_no ?? 0,
      service_date: ord?.service_date ?? '',
      branch_id: ord?.branch_id ?? '',
      branch_code: br?.code ?? '—',
      source_id: ord?.source_id ?? null,
      customer_name: cust?.customer_name ?? '',
      customer_phone: cust?.customer_phone ?? null,
      service_name: svc?.name ?? '—',
      service_item_id: row.service_item_id,
      service_category_id: svc?.service_category_id ?? null,
      interrupted_at: row.interruption_at ?? '',
      reason_label: row.interruption_reason,
      notes: row.interruption_notes,
    };
  });

  return { items, branches, sources: srcRes.data ?? [], serviceCategories, serviceItems };
}

function daysAgo(iso: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
}

function summaryFor(it: PendingItem): string {
  const date = it.interrupted_at ? new Date(it.interrupted_at).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : it.service_date;
  const reason = it.reason_label ? ` (${it.reason_label})` : '';
  return `Order #${it.order_no} · ${it.service_name} · interrupted ${date}${reason}`;
}

export default async function PendingReschedulesPage() {
  if (!isManager(await currentSession())) redirect('/dashboard');
  const { items, branches, sources, serviceCategories, serviceItems } = await fetchData();

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
          Click “Create reservation” to book the make-up (the entry drops off automatically), or
          “Mark fulfilled” for an abandoned request.
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
              <TableHead className="w-72 text-right" />
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
                      {it.customer_name || <span className="text-muted-foreground">—</span>}
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
                      <RescheduleRowActions
                        itemId={it.id}
                        summary={summaryFor(it)}
                        prefill={{
                          branchId: it.branch_id,
                          sourceId: it.source_id,
                          guestName: it.customer_name,
                          guestPhone: it.customer_phone,
                          categoryIds: it.service_category_id ? [it.service_category_id] : [],
                          serviceItemId: it.service_item_id,
                        }}
                        branches={branches}
                        sources={sources}
                        serviceCategories={serviceCategories}
                        serviceItems={serviceItems}
                      />
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
