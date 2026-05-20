import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderWorkspace } from '@/components/sales-orders/order-workspace';
import { ReportIncidentDialog } from '@/components/incidents/report-incident-dialog';

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
      billing:billing_destinations!orders_billing_to_id_fkey ( code, name, settlement_type, default_payment_method_id ),
      order_customers ( id, customer_name, customer_phone, seq_no ),
      payments (
        id, order_customer_id, amount_cents, payment_ref, paid_at,
        method:payment_methods ( display_name ),
        tips ( amount_cents )
      ),
      feedback ( order_item_id, score ),
      order_items (
        id, order_customer_id, list_price_cents, discount_amount_cents, final_amount_cents, status,
        therapist_id, resource_id, duration_minutes, actual_start, actual_end,
        service:service_items ( name ),
        therapist:employees ( name ),
        resource:resources ( resource_name )
      )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  const [svc, emp, res, disc, pm, shifts] = await Promise.all([
    supabase
      .from('service_items')
      .select('id, code, name, service_group, duration_minutes, required_resource_type, service_item_prices ( price_cents, price_class, branch_id )')
      .eq('active', true)
      .order('service_group')
      .order('duration_minutes'),
    supabase.from('employees').select('id, employee_code, name, home_branch_id, home_branch:branches ( code )').eq('status', 'active').order('employee_code'),
    supabase.from('resources').select('id, resource_name, resource_type').eq('branch_id', order.branch_id).eq('status', 'active').order('resource_name'),
    supabase.from('discount_classes').select('id, code, description').eq('active', true).order('code'),
    supabase.from('payment_methods').select('id, code, display_name').eq('active', true).order('code'),
    // Therapists with a working shift at this branch on the service date.
    supabase
      .from('employee_shifts')
      .select('employee_id')
      .eq('branch_id', order.branch_id)
      .eq('shift_date', order.service_date)
      .in('shift_type', ['regular', 'cross_branch', 'on_call']),
  ]);

  const svcCardsRes = await supabase
    .from('stored_value_cards')
    .select('id, card_no, current_balance_cents, customer:customers ( name )')
    .eq('status', 'active')
    .gt('current_balance_cents', 0)
    .order('card_no');

  // Therapists / stations currently mid-service anywhere (started, not finished).
  const busy = await supabase
    .from('order_items')
    .select('therapist_id, resource_id')
    .eq('status', 'in_service');
  const busyTherapistIds = [...new Set((busy.data ?? []).map((b) => b.therapist_id).filter(Boolean) as string[])];
  const busyResourceIds = [...new Set((busy.data ?? []).map((b) => b.resource_id).filter(Boolean) as string[])];

  const scheduledIds = new Set((shifts.data ?? []).map((s) => s.employee_id));
  const allEmployees = (emp.data ?? []).map((e) => ({
    id: e.id,
    code: e.employee_code,
    name: e.name,
    homeBranchId: e.home_branch_id as string | null,
    homeBranchCode: one(e.home_branch)?.code ?? null,
  }));
  // "At this branch" = home-branched here OR rostered here today. Everyone else is
  // borrowable (manual cross-branch dispatch — auto-assign never reaches for them).
  const belongsHere = (e: { homeBranchId: string | null; id: string }) =>
    e.homeBranchId === order.branch_id || scheduledIds.has(e.id);
  const thisBranchEmployees = allEmployees
    .filter(belongsHere)
    .map((e) => ({ id: e.id, code: e.code, name: e.name }));
  const borrowableEmployees = allEmployees
    .filter((e) => !belongsHere(e))
    .map((e) => ({ id: e.id, code: e.code, name: e.name, homeBranchCode: e.homeBranchCode }));

  return {
    order,
    serviceItems: (svc.data ?? []).map((s) => {
      const normal = (s.service_item_prices ?? []).find((p) => p.price_class === 'Normal' && p.branch_id === null);
      return {
        id: s.id,
        name: s.name,
        group: s.service_group ?? s.name,
        duration_minutes: s.duration_minutes,
        price_cents: normal?.price_cents ?? null,
        required_resource_type: s.required_resource_type ?? null,
      };
    }),
    employees: thisBranchEmployees,
    borrowableEmployees,
    busyTherapistIds,
    busyResourceIds,
    resources: (res.data ?? []).map((r) => ({ id: r.id, name: r.resource_name, resource_type: r.resource_type ?? null })),
    discountClasses: disc.data ?? [],
    paymentMethods: pm.data ?? [],
    storedValueCards: (svcCardsRes.data ?? []).map((c) => ({
      id: c.id,
      card_no: c.card_no,
      balance_cents: c.current_balance_cents,
      customer_name: one(c.customer)?.name ?? null,
    })),
  };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canManage = isManager(await currentSession());
  const result = await fetchData(id);
  if (!result) notFound();
  const { order, serviceItems, employees, borrowableEmployees, busyTherapistIds, busyResourceIds, resources, discountClasses, paymentMethods, storedValueCards } = result;

  const branch = one(order.branch);
  const source = one(order.source);
  const billing = one(order.billing);

  // An order is AR-billed (invoiced, settled later via Revenue SOA — no counter
  // collection) when its billing destination defaults to the AR method. Those
  // orders stay Completed until the daily Revenue Confirm closes them. Everyone
  // else pays at the counter (cash / PAYMAYA / stored value), flexible.
  const arMethodId = paymentMethods.find((m) => m.code === 'ar')?.id ?? null;
  const arBilled = !!billing?.default_payment_method_id && billing.default_payment_method_id === arMethodId;
  const paymentPolicy = {
    arBilled,
    defaultMethodId: billing?.default_payment_method_id ?? null,
    arBillingLabel: billing ? `${billing.code} — ${billing.name}` : null,
  };

  const orderItemsRaw = order.order_items ?? [];
  const orderPayments = order.payments ?? [];
  const customers = (order.order_customers ?? []).map((c) => {
    const subtotal = orderItemsRaw
      .filter((it) => it.order_customer_id === c.id)
      .reduce((s, it) => s + it.final_amount_cents, 0);
    const paid = orderPayments
      .filter((p) => p.order_customer_id === c.id)
      .reduce((s, p) => s + p.amount_cents, 0);
    return {
      id: c.id,
      customer_name: c.customer_name,
      customer_phone: c.customer_phone,
      seq_no: c.seq_no,
      subtotal_cents: subtotal,
      paid_cents: paid,
    };
  });
  const customerLabel = new Map(
    (order.order_customers ?? []).map((c) => [c.id, `#${c.seq_no} · ${c.customer_name}`]),
  );
  const payments = orderPayments.map((p) => ({
    id: p.id,
    amount_cents: p.amount_cents,
    method_name: one(p.method)?.display_name ?? 'Payment',
    payment_ref: p.payment_ref,
    customer_label: p.order_customer_id ? customerLabel.get(p.order_customer_id) ?? null : null,
    tip_cents: (p.tips ?? []).reduce((s, t) => s + t.amount_cents, 0),
    paid_at: p.paid_at,
  }));
  const feedbackByItem = new Map((order.feedback ?? []).map((f) => [f.order_item_id, f.score]));
  const items = (order.order_items ?? []).map((it) => {
    const svc = one(it.service);
    const th = one(it.therapist);
    const resource = one(it.resource);
    return {
      id: it.id,
      order_customer_id: it.order_customer_id,
      service_name: svc?.name ?? 'Service',
      therapist_name: th?.name ?? null,
      therapist_id: it.therapist_id,
      resource_id: it.resource_id,
      station_name: resource?.resource_name ?? null,
      duration_minutes: it.duration_minutes,
      actual_start: it.actual_start,
      actual_end: it.actual_end,
      list_price_cents: it.list_price_cents,
      discount_amount_cents: it.discount_amount_cents,
      final_amount_cents: it.final_amount_cents,
      status: it.status,
      feedback_score: feedbackByItem.get(it.id) ?? null,
    };
  });

  const editable = ['draft', 'open', 'in_service'].includes(order.status);

  // Change history — merged audit timeline (status changes + edits/reopens).
  const supabaseLog = createServiceClient();
  const [statusLog, editLog] = await Promise.all([
    supabaseLog
      .from('order_status_log')
      .select('from_status, to_status, reason, changed_at, staff:staff_users!order_status_log_changed_by_staff_id_fkey ( display_name )')
      .eq('entity_type', 'order')
      .eq('entity_id', id),
    supabaseLog
      .from('order_edit_log')
      .select('from_status, to_status, edit_reason, edited_at, staff:staff_users!order_edit_log_edited_by_staff_id_fkey ( display_name )')
      .eq('order_id', id),
  ]);
  const history = [
    ...(statusLog.data ?? []).map((l) => ({
      at: l.changed_at,
      label: `${l.from_status ?? '—'} → ${l.to_status}`,
      reason: l.reason,
      who: one(l.staff)?.display_name ?? null,
    })),
    ...(editLog.data ?? []).map((l) => ({
      at: l.edited_at,
      label: `Reopen ${l.from_status ?? ''} → ${l.to_status ?? ''}`,
      reason: l.edit_reason,
      who: one(l.staff)?.display_name ?? null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

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
          <div className="ml-auto">
            <ReportIncidentDialog orderId={order.id} defaultCustomerName={customers[0]?.customer_name ?? ''} />
          </div>
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
        payments={payments}
        serviceItems={serviceItems}
        employees={employees}
        borrowableEmployees={borrowableEmployees}
        busyTherapistIds={busyTherapistIds}
        busyResourceIds={busyResourceIds}
        resources={resources}
        discountClasses={discountClasses}
        paymentMethods={paymentMethods}
        storedValueCards={storedValueCards}
        paymentPolicy={paymentPolicy}
        canManage={canManage}
      />

      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Change History</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {history.map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <span className="font-semibold capitalize">{h.label.replace(/_/g, ' ')}</span>
                    {h.reason && <span className="ml-2 font-medium text-muted-foreground">{h.reason}</span>}
                  </div>
                  <div className="shrink-0 text-right text-xs font-medium text-muted-foreground">
                    <div>{h.who ?? 'system'}</div>
                    <div className="tabular">{new Date(h.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'short', timeStyle: 'short' })}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
