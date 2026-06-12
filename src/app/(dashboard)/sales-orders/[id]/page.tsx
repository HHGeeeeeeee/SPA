import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { type BoundConsentInfo } from '@/components/sales-orders/guest-consents';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderWorkspace } from '@/components/sales-orders/order-workspace';
import { OrderNoteEditor } from '@/components/sales-orders/order-note-editor';
import { OrderSourceBillingEditor } from '@/components/sales-orders/order-source-billing-editor';
import { OrderBranchUnitEditor } from '@/components/sales-orders/order-branch-unit-editor';
import { OrderLocationEditor } from '@/components/sales-orders/order-location-editor';
import { OrderStatusActions } from '@/components/sales-orders/order-status-actions';
import { ServiceBadge, PaymentBadge } from '@/components/sales-orders/order-badges';
import { ReportIncidentDialog } from '@/components/incidents/report-incident-dialog';
import { loadOrderAuditTrail } from '@/lib/order-audit-trail';

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
      folio_lines (
        id, order_customer_id, order_item_id, kind, amount_cents, payment_ref, note, posted_at,
        method:payment_methods ( display_name ),
        shift:shifts ( label, branch:branches!shifts_branch_id_fkey ( code ) ),
        billing:billing_destinations!folio_lines_billing_destination_id_fkey ( name ),
        card:stored_value_cards!folio_lines_stored_value_card_id_fkey ( card_no ),
        tx_code:transaction_codes!folio_lines_transaction_code_id_fkey ( code ),
        posted_by_staff:staff_users!folio_lines_posted_by_fkey ( display_name )
      ),
      feedback ( order_item_id, score ),
      order_items (
        id, order_customer_id, list_price_cents, discount_amount_cents, final_amount_cents, status,
        service_item_id, service_category_id, discount_class_id,
        therapist_id, resource_id, external_room_no, duration_minutes, scheduled_start, actual_start, actual_end, bed_released_at, interruption_reason,
        service:service_items ( name, prep_before_minutes, cleanup_after_minutes ),
        category:service_categories ( name ),
        therapist:employees ( name, home_branch:branches!employees_home_branch_id_fkey ( code ) ),
        resource:resources ( resource_name, branch:branches!resources_branch_id_fkey ( code ) )
      )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  const [svc, emp, res, disc, pm, shifts, brs, srcAll, billAll, brAll, txCodes] = await Promise.all([
    supabase
      .from('service_items')
      .select('id, code, name, service_group, service_category_id, duration_minutes, allowed_resource_types, category:service_categories ( name ), service_item_prices ( price_cents, price_class, branch_id )')
      .eq('active', true)
      .order('service_group')
      .order('duration_minutes'),
    supabase.from('employees').select('id, employee_code, name, gender, home_branch_id, home_branch:branches ( code )').eq('status', 'active').order('employee_code'),
    supabase.from('resources').select('id, resource_name, resource_type, branch:branches!resources_branch_id_fkey ( code )').eq('branch_id', order.branch_id).eq('status', 'active').order('resource_name'),
    supabase.from('discount_classes').select('id, code, description, discount_percent, discount_amount_cents').eq('active', true).order('code'),
    supabase.from('payment_methods').select('id, code, display_name').eq('active', true).order('code'),
    // Therapists with a working shift on the service date — fetched for ALL
    // branches so we can show the full share-group pool with availability.
    supabase
      .from('employee_shifts')
      .select('employee_id, branch_id, shift_start, shift_end')
      .eq('shift_date', order.service_date)
      .in('shift_type', ['regular', 'cross_branch', 'on_call']),
    // Branches + their sharing group (to limit borrowing to the same pool).
    supabase.from('branches').select('id, code, therapist_share_group').eq('active', true),
    // All customer sources / billing destinations — for the inline Source /
    // Billing editor on the order detail panel.
    supabase.from('customer_sources').select('id, code, name, default_billing_to_id').order('code'),
    supabase.from('billing_destinations').select('id, code, name, transaction_code:transaction_codes ( code )').eq('active', true).order('code'),
    // All active branches + their business units — for the inline Branch /
    // Business Unit editor on the order detail panel.
    supabase.from('branches').select('id, code, name, branch_business_units ( business_units ( id, name ) )').eq('active', true).order('code'),
    // Payment + revenue transaction codes — drive the read-only code shown in
    // the folio dialogs (payment by branch+method, revenue is branchless).
    supabase.from('transaction_codes').select('id, code, branch_id, payment_method_id, credit_account, transaction_type').in('transaction_type', ['payment', 'revenue']).eq('active', true),
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
  // For busy therapists, also grab scheduled_start + duration so we can show
  // an estimated "free at" time in the picker.
  const busy = await supabase
    .from('order_items')
    .select('therapist_id, resource_id, scheduled_start, actual_start, duration_minutes')
    .eq('status', 'in_service');
  const busyTherapistIds = [...new Set((busy.data ?? []).map((b) => b.therapist_id).filter(Boolean) as string[])];
  // therapist_id → estimated end time (ISO string)
  const busyTherapistEndMap: Record<string, string> = {};
  for (const b of busy.data ?? []) {
    if (!b.therapist_id) continue;
    const startIso = b.actual_start ?? b.scheduled_start;
    if (!startIso) continue;
    const endMs = Date.parse(startIso) + (b.duration_minutes ?? 60) * 60_000;
    const endIso = new Date(endMs).toISOString();
    // Keep the latest end if a therapist somehow has multiple in-service lines.
    if (!busyTherapistEndMap[b.therapist_id] || endIso > busyTherapistEndMap[b.therapist_id]) {
      busyTherapistEndMap[b.therapist_id] = endIso;
    }
  }

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

  // Employee shift data keyed by employee_id. Includes shifts at any branch.
  const scheduledHere = new Set(
    (shifts.data ?? []).filter((s) => s.branch_id === order.branch_id).map((s) => s.employee_id),
  );
  const scheduledAnywhere = new Set((shifts.data ?? []).map((s) => s.employee_id));
  // Which branch each employee is rostered at today (for share-group label).
  const shiftBranchOf = new Map<string, string>();
  for (const s of shifts.data ?? []) shiftBranchOf.set(s.employee_id, s.branch_id);

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
  const branchCodeById = new Map((brs.data ?? []).map((b) => [b.id, b.code]));

  // Therapists rostered at this branch today.
  const thisBranchEmployees = allEmployees
    .filter((e) => scheduledHere.has(e.id))
    .map((e) => ({ id: e.id, code: e.code, name: e.name, gender: e.gender, visiting: e.homeBranchId !== order.branch_id }));
  // Share-group therapists NOT rostered at this branch — show with their
  // rostered branch code so the desk knows where they are.
  const borrowableEmployees = allEmployees
    .filter((e) => !scheduledHere.has(e.id) && scheduledAnywhere.has(e.id) && shareBranchIds.has(shiftBranchOf.get(e.id) ?? ''))
    .map((e) => ({ id: e.id, code: e.code, name: e.name, gender: e.gender, homeBranchCode: branchCodeById.get(shiftBranchOf.get(e.id) ?? '') ?? e.homeBranchCode }));
  // Therapists already assigned to this order's items must always be in the
  // employee lists — even when they have no shift today (assigned earlier,
  // shift removed, etc.). Without this the ServiceLineEditor can't resolve
  // their name and shows a raw UUID in the dropdown trigger.
  const knownIds = new Set([...thisBranchEmployees.map((e) => e.id), ...borrowableEmployees.map((e) => e.id)]);
  const assignedIds = new Set(
    (order.order_items ?? []).map((it) => it.therapist_id).filter((id): id is string => !!id),
  );
  for (const e of allEmployees) {
    if (assignedIds.has(e.id) && !knownIds.has(e.id)) {
      borrowableEmployees.push({ id: e.id, code: e.code, name: e.name, gender: e.gender, homeBranchCode: e.homeBranchCode });
    }
  }

  // ── Plan-start availability data (service-line therapist picker) ───────────
  // Per therapist on the service date: shift windows (so we know if they're on
  // shift at the line's planned start), other booked/in-service windows (clash),
  // and absence blocks. All as epoch-ms ranges so the client just does overlap
  // math against the line's [planStart, planEnd).
  const SD = order.service_date as string;
  const timeToMs = (t: string | null): number | null => (t ? Date.parse(`${SD}T${t.slice(0, 5)}:00+08:00`) : null);
  const shiftWindowsByTherapist: Record<string, { s: number; e: number }[]> = {};
  for (const s of shifts.data ?? []) {
    const st = timeToMs(s.shift_start);
    let en = timeToMs(s.shift_end);
    if (st == null || en == null) continue;
    if (en <= st) en += 24 * 60 * 60 * 1000; // shift trades past midnight
    (shiftWindowsByTherapist[s.employee_id] ??= []).push({ s: st, e: en });
  }

  const dayItemsRes = await supabase
    .from('order_items')
    .select('id, therapist_id, scheduled_start, slot_start, slot_end, duration_minutes, order:orders!order_items_order_id_fkey ( service_date )')
    .in('status', ['draft', 'in_service'])
    .not('therapist_id', 'is', null);
  const bookingWindowsByTherapist: Record<string, { s: number; e: number; item: string }[]> = {};
  for (const it of dayItemsRes.data ?? []) {
    if (one(it.order)?.service_date !== SD || !it.therapist_id) continue;
    const startIso = it.slot_start ?? it.scheduled_start;
    if (!startIso) continue;
    const s = Date.parse(startIso);
    const e = it.slot_end ? Date.parse(it.slot_end) : s + (it.duration_minutes ?? 60) * 60_000;
    (bookingWindowsByTherapist[it.therapist_id] ??= []).push({ s, e, item: it.id });
  }

  const blocksRes = await supabase
    .from('therapist_block')
    .select('employee_id, start_at, end_at')
    .eq('block_date', SD);
  const blockWindowsByTherapist: Record<string, { s: number; e: number }[]> = {};
  for (const b of blocksRes.data ?? []) {
    (blockWindowsByTherapist[b.employee_id] ??= []).push({ s: Date.parse(b.start_at), e: Date.parse(b.end_at) });
  }

  const lineupRes = await supabase
    .from('daily_lineup')
    .select('ordered_ids')
    .eq('branch_id', order.branch_id)
    .eq('lineup_date', SD)
    .maybeSingle();
  const lineupRank: Record<string, number> = {};
  (lineupRes.data?.ordered_ids ?? []).forEach((id, i) => { lineupRank[id] = i; });

  const allowedBranchIds = await getAllowedBranchIds();

  // Current open cash shift per accessible branch — shown read-only in the folio
  // dialogs (and a "please open a shift" hint when a branch has none).
  const openShiftsRes = await supabase
    .from('shifts')
    .select('id, label, branch_id')
    .eq('status', 'open')
    .in('branch_id', [...allowedBranchIds]);

  return {
    order,
    serviceItems: (svc.data ?? []).map((s) => {
      const normal = (s.service_item_prices ?? []).find((p) => p.price_class === 'Normal' && p.branch_id === null);
      return {
        id: s.id,
        name: s.name,
        group: s.service_group ?? s.name,
        categoryId: s.service_category_id as string,
        categoryName: one(s.category)?.name ?? null,
        duration_minutes: s.duration_minutes,
        price_cents: normal?.price_cents ?? null,
        allowed_resource_types: s.allowed_resource_types ?? [],
      };
    }),
    employees: thisBranchEmployees,
    borrowableEmployees,
    busyTherapistIds,
    busyTherapistEndMap,
    busyResourceIds,
    shiftWindowsByTherapist,
    bookingWindowsByTherapist,
    blockWindowsByTherapist,
    lineupRank,
    serviceDate: SD,
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
    allBilling: (billAll.data ?? []).map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      tx_code: (Array.isArray(b.transaction_code) ? b.transaction_code[0] : b.transaction_code)?.code ?? null,
    })) as { id: string; code: string; name: string; tx_code: string | null }[],
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
    // Branches the user can post a folio line to (code only) + this order's branch.
    accessibleBranches: (brAll.data ?? []).filter((b) => allowedBranchIds.has(b.id)).map((b) => ({ id: b.id, code: b.code })),
    orderBranchId: order.branch_id as string | null,
    transactionCodes: (txCodes.data ?? []) as { id: string; code: string; branch_id: string | null; payment_method_id: string | null; credit_account: string | null; transaction_type: string }[],
    openShifts: (openShiftsRes.data ?? []).map((s) => ({ branchId: s.branch_id as string, label: s.label as string })),
  };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  const canManage = isManager(session);
  const result = await fetchData(id);
  if (!result) notFound();

  // The user's own first open shift — its branch becomes the highest-priority
  // default for folio postings, because staff rotate across branches daily.
  const supabase = createServiceClient();
  const { data: myShift } = await supabase
    .from('shifts')
    .select('branch_id')
    .eq('status', 'open')
    .eq('opened_by', session?.staffUserId ?? '')
    .order('opened_at')
    .limit(1)
    .maybeSingle();
  const userShiftBranchId: string | null = myShift?.branch_id ?? null;

  const { order, serviceItems, employees, borrowableEmployees, busyTherapistIds, busyTherapistEndMap, busyResourceIds, shiftWindowsByTherapist, bookingWindowsByTherapist, blockWindowsByTherapist, lineupRank, serviceDate, resources, discountClasses, paymentMethods, storedValueCards, capabilityByEmployee, allSources, allBilling, allBranches, accessibleBranches, orderBranchId, transactionCodes, openShifts } = result;

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
  const orderLines = order.folio_lines ?? [];
  const signedAmt = (l: { kind: string; amount_cents: number }) => (l.kind === 'refund' ? -l.amount_cents : l.amount_cents);
  const payLines = orderLines.filter((l) => l.kind === 'payment' || l.kind === 'refund');
  const tipTotal = orderLines.filter((l) => l.kind === 'tip').reduce((s, l) => s + l.amount_cents, 0);
  // Manual folio adjustments (Add revenue / Adjust charge): kind=revenue lines
  // with no order_item_id. Net of positive add-revenue and negative adjust-charge
  // — already folded into total_cents server-side; surfaced as its own Totals line.
  const adjustmentTotal = orderLines
    .filter((l) => l.kind === 'revenue' && !l.order_item_id)
    .reduce((s, l) => s + l.amount_cents, 0);
  const customerLabel = new Map(
    (order.order_customers ?? []).map((c) => [c.id, `#${c.seq_no} · ${c.customer_name}`]),
  );
  // A service-revenue folio line carries no guest of its own — it's posted from
  // an order_item. Map each item → its service name + the guest it serves, so a
  // revenue row can surface both even though they don't live on the line.
  const itemInfo = new Map(
    (order.order_items ?? []).map((it) => [it.id, {
      service: one<{ name: string }>(it.service ?? null)?.name ?? one<{ name: string }>(it.category ?? null)?.name ?? null,
      guestId: it.order_customer_id ?? null,
    }]),
  );
  const folioLines = orderLines.map((l) => {
    const sh = one(l.shift);
    const item = l.order_item_id ? itemInfo.get(l.order_item_id) ?? null : null;
    // Guest: prefer the line's own guest (AR payments), else the served guest
    // inherited from the order_item (service-revenue lines).
    const guestId = l.order_customer_id ?? item?.guestId ?? null;
    return {
      id: l.id,
      kind: l.kind,
      amount_cents: l.amount_cents,
      posted_at: l.posted_at,
      method_name: one(l.method)?.display_name ?? null,
      shift_label: sh?.label ?? null,
      branch_code: one<{ code: string }>(sh?.branch ?? null)?.code ?? null,
      created_by: one(l.posted_by_staff)?.display_name ?? null,
      created_at: l.posted_at,
      customer_label: guestId ? customerLabel.get(guestId) ?? null : null,
      service_name: item?.service ?? null,
      ref: l.payment_ref ?? null,
      note: l.note ?? null,
      billing_name: one<{ name: string }>(l.billing ?? null)?.name ?? null,
      card_no: one<{ card_no: string }>(l.card ?? null)?.card_no ?? null,
      tx_code: one<{ code: string }>(l.tx_code ?? null)?.code ?? null,
    };
  });
  const customers = (order.order_customers ?? []).map((c) => {
    const subtotal = orderItemsRaw
      .filter((it) => it.order_customer_id === c.id && !['cancelled', 'no_show'].includes(it.status))
      .reduce((s, it) => s + (it.final_amount_cents ?? 0), 0);
    // Net toward this guest's service bill: gross payment minus refunds and
    // tips (tips are revenue on top, not payment of the service charge).
    const paid = orderLines
      .filter((l) => l.order_customer_id === c.id && ['payment', 'refund', 'tip'].includes(l.kind))
      .reduce((s, l) => s + (l.kind === 'payment' ? l.amount_cents : -l.amount_cents), 0);
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

  const payments = payLines.map((l, i) => ({
    id: l.id,
    amount_cents: signedAmt(l),
    method_name: one(l.method)?.display_name ?? 'Payment',
    payment_ref: l.payment_ref,
    customer_label: l.order_customer_id ? customerLabel.get(l.order_customer_id) ?? null : null,
    tip_cents: i === 0 ? tipTotal : 0,
    paid_at: l.posted_at,
  }));
  const feedbackByItem = new Map((order.feedback ?? []).map((f) => [f.order_item_id, f.score]));
  const items = (order.order_items ?? []).map((it) => {
    const svc = one(it.service);
    const cat = one(it.category);
    const th = one(it.therapist);
    const resource = one(it.resource);
    return {
      id: it.id,
      order_customer_id: it.order_customer_id,
      service_item_id: it.service_item_id,
      service_category_id: it.service_category_id ?? null,
      discount_class_id: it.discount_class_id,
      service_name: svc?.name ?? cat?.name ?? 'Service',
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
  const { entries: auditTrail, names: auditNames } = await loadOrderAuditTrail(id);

  // Signed intake/consent forms attached to this order's guest lines, keyed by
  // order_customer_id for the per-guest consent panel.
  const boundConsentByGuest: Record<string, BoundConsentInfo> = {};
  {
    const sb = createServiceClient();
    const { data: bc } = await sb
      .from('intake_consent')
      .select('id, order_customer_id, name, signed_at, language, pressure')
      .eq('order_id', id)
      .eq('status', 'bound');
    for (const c of bc ?? []) {
      if (c.order_customer_id) {
        boundConsentByGuest[c.order_customer_id] = {
          id: c.id,
          name: c.name,
          signed_at: c.signed_at,
          language: c.language,
          pressure: c.pressure,
        };
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/calendar" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Calendar
        </Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h2 className="text-3xl font-bold tracking-tight font-mono">{order.order_no}</h2>
          <ServiceBadge status={order.status} />
          <PaymentBadge total_cents={order.total_cents} paid_cents={order.paid_cents} is_ar={arBilled} status={order.status} />
          <OrderStatusActions orderId={order.id} status={order.status} canManage={canManage} itemCount={items.length} hasPayments={payments.length > 0} />
          <div className="ml-auto flex items-center gap-3">
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
              {tipTotal > 0 && (
                <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Tips (PAYMAYA)</dt><dd className="font-bold tabular text-primary">+{peso(tipTotal)}</dd></div>
              )}
              {adjustmentTotal !== 0 && (
                <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Adjustments</dt><dd className={`font-bold tabular ${adjustmentTotal < 0 ? 'text-destructive' : ''}`}>{adjustmentTotal < 0 ? '-' : '+'}{peso(Math.abs(adjustmentTotal))}</dd></div>
              )}
              <div className="flex justify-between border-t border-border pt-2"><dt className="font-bold">Total</dt><dd className="font-extrabold tabular text-lg">{peso(order.total_cents)}</dd></div>
              <div className="flex justify-between"><dt className="font-medium text-muted-foreground">Paid</dt><dd className="font-bold tabular">{peso(order.paid_cents)}</dd></div>
              <div className={`flex justify-between ${order.total_cents - order.paid_cents > 0 ? 'text-destructive' : ''}`}><dt className="font-bold">Due</dt><dd className="font-extrabold tabular text-lg">{peso(Math.max(0, order.total_cents - order.paid_cents))}</dd></div>
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
          billing_to_id: order.billing_to_id,
        }}
        customers={customers}
        items={items}
        payments={payments}
        folioLines={folioLines}
        history={history}
        auditTrail={auditTrail}
        auditNames={auditNames}
        serviceItems={serviceItems}
        employees={employees}
        borrowableEmployees={borrowableEmployees}
        busyTherapistIds={busyTherapistIds}
        busyTherapistEndMap={busyTherapistEndMap}
        busyResourceIds={busyResourceIds}
        shiftWindowsByTherapist={shiftWindowsByTherapist}
        bookingWindowsByTherapist={bookingWindowsByTherapist}
        blockWindowsByTherapist={blockWindowsByTherapist}
        lineupRank={lineupRank}
        serviceDate={serviceDate}
        resources={resources}
        discountClasses={discountClasses}
        sourceDefaultDiscountId={source?.default_discount_class_id ?? null}
        sourceDiscountLocked={source?.discount_locked ?? false}
        paymentMethods={paymentMethods}
        storedValueCards={storedValueCards}
        capabilityByEmployee={capabilityByEmployee}
        paymentPolicy={paymentPolicy}
        accessibleBranches={accessibleBranches}
        orderBranchId={orderBranchId}
        transactionCodes={transactionCodes}
        openShifts={openShifts}
        userShiftBranchId={userShiftBranchId}
        billingDestinations={allBilling}
        boundConsents={boundConsentByGuest}
      />
    </div>
  );
}
