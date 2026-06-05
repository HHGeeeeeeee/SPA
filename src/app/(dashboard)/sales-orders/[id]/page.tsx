import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderWorkspace } from '@/components/sales-orders/order-workspace';
import { OrderNoteEditor } from '@/components/sales-orders/order-note-editor';
import { OrderSourceBillingEditor } from '@/components/sales-orders/order-source-billing-editor';
import { OrderBranchUnitEditor } from '@/components/sales-orders/order-branch-unit-editor';
import { OrderLocationEditor } from '@/components/sales-orders/order-location-editor';
import { PaymentAdjust } from '@/components/sales-orders/payment-adjust';
import { OrderStatusActions } from '@/components/sales-orders/order-status-actions';
import { ServiceBadge, PaymentBadge } from '@/components/sales-orders/order-badges';
import { RetryOrderPostingButton } from '@/components/sales-orders/retry-order-posting-button';
import { ReportIncidentDialog } from '@/components/incidents/report-incident-dialog';
import { loadOrderAuditTrail } from '@/lib/order-audit-trail';
import { listPinCapableManagers } from '@/lib/manager-pin';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchData(id: string) {
  const supabase = createServiceClient();
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, order_no, status, order_type, service_location_type, external_hotel_id, service_date, note, branch_id, business_unit_id, source_id, billing_to_id,
      subtotal_cents, discount_cents, total_cents, paid_cents,
      branch:branches!orders_branch_id_fkey ( code, name ),
      source:customer_sources ( code, name, default_discount_class_id, discount_locked ),
      billing:billing_destinations!orders_billing_to_id_fkey ( code, name, settlement_type, default_payment_method_id ),
      order_customers ( id, customer_name, customer_phone, seq_no, gender ),
      payments (
        id, order_customer_id, amount_cents, payment_ref, paid_at,
        method:payment_methods ( display_name ),
        tips ( amount_cents )
      ),
      feedback ( order_item_id, score ),
      order_items (
        id, order_customer_id, list_price_cents, discount_amount_cents, final_amount_cents, status,
        service_item_id, discount_class_id,
        therapist_id, resource_id, external_room_no, duration_minutes, scheduled_start, actual_start, actual_end, bed_released_at, interruption_reason,
        service:service_items ( name, prep_before_minutes, cleanup_after_minutes ),
        therapist:employees ( name, home_branch:branches!employees_home_branch_id_fkey ( code ) ),
        resource:resources ( resource_name, branch:branches!resources_branch_id_fkey ( code ) )
      )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  const [svc, emp, res, disc, pm, shifts, brs, srcAll, billAll, brAll] = await Promise.all([
    supabase
      .from('service_items')
      .select('id, code, name, service_group, duration_minutes, allowed_resource_types, service_item_prices ( price_cents, price_class, branch_id )')
      .eq('active', true)
      .order('service_group')
      .order('duration_minutes'),
    supabase.from('employees').select('id, employee_code, name, gender, home_branch_id, home_branch:branches ( code )').eq('status', 'active').order('employee_code'),
    supabase.from('resources').select('id, resource_name, resource_type, branch:branches!resources_branch_id_fkey ( code )').eq('branch_id', order.branch_id).eq('status', 'active').order('resource_name'),
    supabase.from('discount_classes').select('id, code, description, discount_percent, discount_amount_cents').eq('active', true).order('code'),
    supabase.from('payment_methods').select('id, code, display_name').eq('active', true).order('code'),
    // Therapists with a working shift at this branch on the service date.
    supabase
      .from('employee_shifts')
      .select('employee_id')
      .eq('branch_id', order.branch_id)
      .eq('shift_date', order.service_date)
      .in('shift_type', ['regular', 'cross_branch', 'on_call']),
    // Branches + their sharing group (to limit borrowing to the same pool).
    supabase.from('branches').select('id, therapist_share_group').eq('active', true),
    // All customer sources / billing destinations — for the inline Source /
    // Billing editor on the order detail panel.
    supabase.from('customer_sources').select('id, code, name, default_billing_to_id').order('code'),
    supabase.from('billing_destinations').select('id, code, name').eq('active', true).order('code'),
    // All active branches + their business units — for the inline Branch /
    // Business Unit editor on the order detail panel.
    supabase.from('branches').select('id, code, name, branch_business_units ( business_units ( id, name ) )').eq('active', true).order('code'),
  ]);

  const svcCardsRes = await supabase
    .from('stored_value_cards')
    .select('id, card_no, current_balance_cents, customer:customers ( name )')
    .eq('status', 'active')
    .gt('current_balance_cents', 0)
    .order('card_no');

  // Therapist skills: employee → service groups they can perform.
  const capRes = await supabase.from('employee_service_groups').select('employee_id, service_group');
  const capabilityByEmployee: Record<string, string[]> = {};
  for (const c of capRes.data ?? []) {
    (capabilityByEmployee[c.employee_id] ??= []).push(c.service_group);
  }

  // Therapists / stations currently mid-service anywhere (started, not finished).
  const busy = await supabase
    .from('order_items')
    .select('therapist_id, resource_id')
    .eq('status', 'in_service');
  const busyTherapistIds = [...new Set((busy.data ?? []).map((b) => b.therapist_id).filter(Boolean) as string[])];

  // Beds still inside their post-service cleanup buffer are occupied too — a
  // finished line holds its bed for cleanup_after_minutes unless released early.
  // (The therapist is free during cleanup, so this only blocks the station.)
  const cleaning = await supabase
    .from('order_items')
    .select('resource_id, actual_end, service:service_items ( cleanup_after_minutes )')
    .in('status', ['service_completed', 'interrupted'])
    .not('resource_id', 'is', null)
    .not('actual_end', 'is', null)
    .is('bed_released_at', null);
  const nowMs = Date.now();
  const cleaningResourceIds = (cleaning.data ?? [])
    .filter((r) => {
      const mins = one(r.service)?.cleanup_after_minutes ?? 0;
      return mins > 0 && Date.parse(r.actual_end!) + mins * 60000 > nowMs;
    })
    .map((r) => r.resource_id as string);
  const busyResourceIds = [...new Set([
    ...((busy.data ?? []).map((b) => b.resource_id).filter(Boolean) as string[]),
    ...cleaningResourceIds,
  ])];

  const scheduledIds = new Set((shifts.data ?? []).map((s) => s.employee_id));
  const allEmployees = (emp.data ?? []).map((e) => ({
    id: e.id,
    code: e.employee_code,
    name: e.name,
    gender: (e.gender as string | null) ?? null,
    homeBranchId: e.home_branch_id as string | null,
    homeBranchCode: one(e.home_branch)?.code ?? null,
  }));
  // Branches in the same therapist-sharing group as this order's branch — only
  // their staff can be borrowed.
  const myGroup = (brs.data ?? []).find((b) => b.id === order.branch_id)?.therapist_share_group ?? null;
  const shareBranchIds = new Set(
    myGroup ? (brs.data ?? []).filter((b) => b.therapist_share_group === myGroup).map((b) => b.id) : [],
  );

  // Only therapists actually rostered here today are normally selectable —
  // someone off-shift shouldn't be assignable. Same-sharing-group staff not
  // rostered here are offered separately as a manual "borrow" (auto-assign skips
  // them). With no sharing group set, nothing is borrowable.
  const rosteredHere = (e: { id: string }) => scheduledIds.has(e.id);
  const thisBranchEmployees = allEmployees
    .filter(rosteredHere)
    // visiting = on a cross-branch shift here but home is elsewhere; auto-assign
    // prefers home therapists over these.
    .map((e) => ({ id: e.id, code: e.code, name: e.name, gender: e.gender, visiting: e.homeBranchId !== order.branch_id }));
  const borrowableEmployees = allEmployees
    .filter((e) => !rosteredHere(e) && e.homeBranchId !== order.branch_id && e.homeBranchId !== null && shareBranchIds.has(e.homeBranchId))
    .map((e) => ({ id: e.id, code: e.code, name: e.name, gender: e.gender, homeBranchCode: e.homeBranchCode }));

  const allowedBranchIds = await getAllowedBranchIds();

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
        allowed_resource_types: s.allowed_resource_types ?? [],
      };
    }),
    employees: thisBranchEmployees,
    borrowableEmployees,
    busyTherapistIds,
    busyResourceIds,
    resources: (res.data ?? []).map((r) => ({ id: r.id, name: r.resource_name, resource_type: r.resource_type ?? null, branchCode: one(r.branch)?.code ?? null })),
    discountClasses: disc.data ?? [],
    paymentMethods: pm.data ?? [],
    storedValueCards: (svcCardsRes.data ?? []).map((c) => ({
      id: c.id,
      card_no: c.card_no,
      balance_cents: c.current_balance_cents,
      customer_name: one(c.customer)?.name ?? null,
    })),
    capabilityByEmployee,
    allSources: (srcAll.data ?? []) as { id: string; code: string; name: string; default_billing_to_id: string | null }[],
    allBilling: (billAll.data ?? []) as { id: string; code: string; name: string }[],
    allBranches: (() => {
      return (brAll.data ?? [])
        .filter((b) => allowedBranchIds.has(b.id))
        .map((b) => ({
          id: b.id,
          name: b.name,
          businessUnits: (b.branch_business_units ?? [])
            .map((row) => (Array.isArray(row.business_units) ? row.business_units[0] : row.business_units))
            .filter(Boolean) as { id: string; name: string }[],
        }));
    })(),
  };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canManage = isManager(await currentSession());
  const result = await fetchData(id);
  if (!result) notFound();
  const { order, serviceItems, employees, borrowableEmployees, busyTherapistIds, busyResourceIds, resources, discountClasses, paymentMethods, storedValueCards, capabilityByEmployee, allSources, allBilling, allBranches } = result;

  const source = one(order.source);
  const billing = one(order.billing);

  // An order is AR-billed (invoiced, settled later via Revenue SOA — no counter
  // collection) when its billing destination defaults to the AR method. Those
  // orders stay Completed until the daily Revenue Confirm closes them. Everyone
  // else pays at the counter (cash / PAYMAYA / stored value), flexible.
  const arMethodId = paymentMethods.find((m) => m.code?.toLowerCase() === 'ar')?.id ?? null;
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
      .filter((it) => it.order_customer_id === c.id && it.status !== 'cancelled')
      .reduce((s, it) => s + (it.final_amount_cents ?? 0), 0);
    const paid = orderPayments
      .filter((p) => p.order_customer_id === c.id)
      .reduce((s, p) => s + p.amount_cents, 0);
    return {
      id: c.id,
      customer_name: c.customer_name,
      customer_phone: c.customer_phone,
      gender: c.gender,
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
      service_item_id: it.service_item_id,
      discount_class_id: it.discount_class_id,
      service_name: svc?.name ?? 'Service',
      therapist_name: th?.name ?? null,
      therapist_home_branch_code: th ? one(th.home_branch)?.code ?? null : null,
      therapist_id: it.therapist_id,
      resource_id: it.resource_id,
      station_name: resource?.resource_name ?? null,
      station_branch_code: resource ? one(resource.branch)?.code ?? null : null,
      scheduled_start: it.scheduled_start ?? null,
      external_room_no: it.external_room_no ?? null,
      duration_minutes: it.duration_minutes,
      prep_minutes: svc?.prep_before_minutes ?? 0,
      cleanup_minutes: svc?.cleanup_after_minutes ?? 0,
      actual_start: it.actual_start,
      actual_end: it.actual_end,
      bed_released_at: it.bed_released_at,
      list_price_cents: it.list_price_cents ?? 0,
      discount_amount_cents: it.discount_amount_cents,
      final_amount_cents: it.final_amount_cents ?? 0,
      status: it.status,
      // A line stopped via "Switch" is interrupted with this reason — shown as
      // "Switched" (not Interrupted) and offered no Redo (the replacement is added).
      switched: it.interruption_reason === 'Switched to another service',
      feedback_score: feedbackByItem.get(it.id) ?? null,
    };
  });

  const editable = ['draft', 'in_service'].includes(order.status);
  // ERP posting outcome (denormalised columns). Read in a separate, cast query so
  // the typed select stays clean and the page is safe even before the migration
  // that adds these columns is applied (missing-column errors are tolerated).
  let erp: { posting_status: string | null; gl_batch_nbr: string | null; posting_error: string | null } = {
    posting_status: null, gl_batch_nbr: null, posting_error: null,
  };
  {
    const sb = createServiceClient();
    const r = await (sb.from('orders') as unknown as {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: typeof erp | null; error: unknown }> } };
    })
      .select('posting_status, gl_batch_nbr, posting_error')
      .eq('id', id)
      .maybeSingle();
    if (!r.error && r.data) erp = r.data;
  }

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
      // Reopens carry a status change; other edits (e.g. note updates) don't.
      label: l.from_status && l.to_status ? `Reopen ${l.from_status} → ${l.to_status}` : 'Edit',
      reason: l.edit_reason,
      who: one(l.staff)?.display_name ?? null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  // Full audit trail — every row change on the order + child entities (items,
  // customers, payments, tips, feedback) with field-level diffs. Powers the
  // rich timeline UI in the Change History tab.
  const auditTrail = await loadOrderAuditTrail(id);

  // Managers with a PIN set — drives the inline approval picker on the
  // Interrupt dialog when staff picks No charge.
  const pinManagers = await listPinCapableManagers();
  const viewerIsManager = isManager(await currentSession());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/sales-orders" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Sales Orders
        </Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h2 className="text-3xl font-bold tracking-tight font-mono">{order.order_no}</h2>
          <ServiceBadge status={order.status} />
          <PaymentBadge total_cents={order.total_cents} paid_cents={order.paid_cents} is_ar={arBilled} status={order.status} />
          {erp.gl_batch_nbr && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground" title="Acumatica GL journal batch">
              GL #{erp.gl_batch_nbr}
            </span>
          )}
          <OrderStatusActions orderId={order.id} status={order.status} canManage={canManage} itemCount={items.length} hasPayments={payments.length > 0} />
          <div className="ml-auto flex items-center gap-3">
            {canManage && !arBilled && ['completed', 'paid'].includes(order.status) && (
              <PaymentAdjust
                orderId={order.id}
                methods={paymentMethods.filter((m) => m.code !== 'ar')}
                storedValueCards={storedValueCards}
                dueCents={Math.max(0, order.total_cents - order.paid_cents)}
                paidCents={order.paid_cents}
              />
            )}
            <ReportIncidentDialog orderId={order.id} defaultCustomerName={customers[0]?.customer_name ?? ''} />
          </div>
        </div>
      </div>

      {/* Loud, unmissable flag: service is done but money hasn't been fully
          collected. Only for counter-paid orders (AR is billed monthly, not at
          the counter) and only while a balance remains. */}
      {!arBilled && order.status === 'completed' && order.total_cents - order.paid_cents > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <TriangleAlert className="size-5 shrink-0 text-destructive mt-0.5" />
          <div className="text-sm">
            <p className="font-bold text-destructive">Not fully paid — {peso(order.total_cents - order.paid_cents)} still due</p>
            <p className="font-medium text-destructive/80">Collect the balance from the guest before they leave.</p>
          </div>
        </div>
      )}

      {/* ERP posting failed → the order was reverted to its prior status; show
          the error so a manager can retry the GL post. */}
      {erp.posting_status === 'failed' && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <TriangleAlert className="size-5 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-bold text-destructive">ERP posting failed — reverted to the previous status.</p>
            <p className="font-medium text-destructive/80">{erp.posting_error ?? 'Unknown error'}</p>
          </div>
          <RetryOrderPostingButton orderId={order.id} canManage={canManage} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base font-bold">Order Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
              <OrderBranchUnitEditor
                orderId={order.id}
                branches={allBranches}
                currentBranchId={order.branch_id}
                currentBusinessUnitId={order.business_unit_id}
                hasItems={(order.order_items ?? []).length > 0}
                editable={editable}
              />
              {/* The "Type" slot now drives the service location (On-site vs
                  Dispatch / external hotel) — order_type (the booking origin)
                  stays in the DB + reports but isn't shown here. */}
              <OrderLocationEditor orderId={order.id} current={order.service_location_type} currentHotelId={order.external_hotel_id} hotels={allBilling} editable={editable} />
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Service Date</dt>
                <dd className="font-semibold mt-0.5 tabular">{order.service_date}</dd></div>
              <OrderSourceBillingEditor
                orderId={order.id}
                sources={allSources}
                billingDestinations={allBilling}
                currentSourceId={order.source_id}
                currentBillingId={order.billing_to_id}
                editable={editable}
              />
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Guests</dt>
                <dd className="font-semibold mt-0.5 tabular">{order.order_customers.length} pax</dd></div>
            </dl>
            <OrderNoteEditor orderId={order.id} initialNote={order.note} />
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
              <div className={`flex justify-between ${order.total_cents - order.paid_cents > 0 ? 'text-destructive' : ''}`}><dt className="font-bold">Due</dt><dd className="font-extrabold tabular text-lg">{peso(Math.max(0, order.total_cents - order.paid_cents))}</dd></div>
              <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Tips (PAYMAYA)</dt><dd className="font-bold tabular text-primary">{peso(payments.reduce((s, p) => s + p.tip_cents, 0))}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <OrderWorkspace
        order={{
          id: order.id,
          status: order.status,
          subtotal_cents: order.subtotal_cents,
          discount_cents: order.discount_cents,
          total_cents: order.total_cents,
          paid_cents: order.paid_cents,
          editable,
          service_date: order.service_date,
          service_location_type: order.service_location_type,
        }}
        customers={customers}
        items={items}
        payments={payments}
        history={history}
        auditTrail={auditTrail}
        pinManagers={pinManagers}
        viewerIsManager={viewerIsManager}
        serviceItems={serviceItems}
        employees={employees}
        borrowableEmployees={borrowableEmployees}
        busyTherapistIds={busyTherapistIds}
        busyResourceIds={busyResourceIds}
        resources={resources}
        discountClasses={discountClasses}
        sourceDefaultDiscountId={source?.default_discount_class_id ?? null}
        sourceDiscountLocked={source?.discount_locked ?? false}
        paymentMethods={paymentMethods}
        storedValueCards={storedValueCards}
        capabilityByEmployee={capabilityByEmployee}
        paymentPolicy={paymentPolicy}
      />
    </div>
  );
}
