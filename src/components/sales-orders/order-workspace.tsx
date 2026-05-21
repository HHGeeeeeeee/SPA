'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2, UserPlus, CreditCard, Wand2, Users, Receipt, Star, History, Play } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addOrderCustomer,
  removeOrderCustomer,
  addOrderItem,
  removeOrderItem,
  startOrderItem,
  startAllServices,
  finishOrderItem,
  skipOrderItem,
  voidPayment,
} from '@/app/(dashboard)/sales-orders/actions';
import { CustomerPaymentCard, type TipTarget } from '@/components/sales-orders/customer-payment-card';
import { FeedbackDialog } from '@/components/sales-orders/feedback-dialog';
import { InterruptDialog } from '@/components/sales-orders/interrupt-dialog';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

interface OrderItem {
  id: string;
  order_customer_id: string;
  service_name: string;
  therapist_name: string | null;
  therapist_home_branch_code: string | null;
  therapist_id: string | null;
  resource_id: string | null;
  station_name: string | null;
  duration_minutes: number | null;
  actual_start: string | null;
  actual_end: string | null;
  list_price_cents: number;
  discount_amount_cents: number;
  final_amount_cents: number;
  status: string;
  feedback_score: number | null;
}
interface OrderCustomer {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  seq_no: number;
  subtotal_cents: number;
  paid_cents: number;
}
interface Opt { id: string; code: string; name: string }
interface BorrowOpt { id: string; code: string; name: string; homeBranchCode: string | null }
interface ResourceOpt { id: string; name: string; resource_type: string | null }
interface DiscountOpt { id: string; code: string; description: string; discount_percent: number; discount_amount_cents: number }
interface ServiceVariant { id: string; name: string; group: string; duration_minutes: number; price_cents: number | null; required_resource_type: string | null }
interface PaymentRecord {
  id: string;
  amount_cents: number;
  method_name: string;
  payment_ref: string | null;
  customer_label: string | null;
  tip_cents: number;
  paid_at: string;
}

interface Props {
  order: {
    id: string;
    status: string;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    paid_cents: number;
    editable: boolean;
  };
  customers: OrderCustomer[];
  items: OrderItem[];
  payments: PaymentRecord[];
  history: { at: string; label: string; reason: string | null; who: string | null }[];
  serviceItems: ServiceVariant[];
  employees: Opt[];
  borrowableEmployees: BorrowOpt[];
  busyTherapistIds: string[];
  busyResourceIds: string[];
  resources: ResourceOpt[];
  discountClasses: DiscountOpt[];
  sourceDefaultDiscountId: string | null;
  sourceDiscountLocked: boolean;
  paymentMethods: { id: string; code: string; display_name: string }[];
  storedValueCards: { id: string; card_no: string; balance_cents: number; customer_name: string | null }[];
  capabilityByEmployee: Record<string, string[]>;
  paymentPolicy: { arBilled: boolean; defaultMethodId: string | null; arBillingLabel: string | null };
  canManage: boolean;
}

const NONE = '__none__';

function peso0(cents: number | null): string {
  return cents == null ? '—' : `₱${(cents / 100).toLocaleString('en-PH')}`;
}

function hm(ts: string | null): string {
  return ts ? new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }) : '';
}

// Time window for a service line: actual once finished, else the projected end
// (start + duration) while it's running. Nothing before it's started.
function timeWindow(actualStart: string | null, actualEnd: string | null, durationMin: number | null): string | null {
  if (!actualStart) return null;
  if (actualEnd) return `${hm(actualStart)}–${hm(actualEnd)}`;
  if (durationMin) {
    const end = new Date(new Date(actualStart).getTime() + durationMin * 60000).toISOString();
    return `${hm(actualStart)}–~${hm(end)}`;
  }
  return hm(actualStart);
}

export function OrderWorkspace({
  order,
  customers,
  items,
  payments,
  history,
  serviceItems,
  employees,
  borrowableEmployees,
  busyTherapistIds,
  busyResourceIds,
  resources,
  discountClasses,
  sourceDefaultDiscountId,
  sourceDiscountLocked,
  paymentMethods,
  storedValueCards,
  paymentPolicy,
  capabilityByEmployee,
  canManage,
}: Props) {
  const [pending, startTransition] = useTransition();

  // add customer
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');

  // add item (per customer) — two-step: group → duration variant
  const [activeCustomer, setActiveCustomer] = useState<string | null>(null);
  const [groupSel, setGroupSel] = useState('');
  const [svcId, setSvcId] = useState('');
  const [therapistId, setTherapistId] = useState(NONE);
  const [resourceId, setResourceId] = useState(NONE);
  const noDiscount = discountClasses.find((d) => d.code === 'DIS-00');
  // New service lines default to the customer source's discount class (if it
  // still exists), else No Discount. Always overridable per line.
  const sourceDefaultValid = !!sourceDefaultDiscountId && discountClasses.some((d) => d.id === sourceDefaultDiscountId);
  const defaultDiscountId = (sourceDefaultValid ? sourceDefaultDiscountId! : null) ?? noDiscount?.id ?? discountClasses[0]?.id ?? '';
  const [discountId, setDiscountId] = useState(defaultDiscountId);
  const [discountOverride, setDiscountOverride] = useState('');
  const selectedDiscountCode = discountClasses.find((d) => d.id === discountId)?.code ?? '';
  const needsDiscountAmount = ['DIS-91', 'DIS-99'].includes(selectedDiscountCode);

  // Counter payment methods only — AR is an invoice arrangement, not a counter
  // collection, so it is never offered here. AR-billed orders skip payment.
  const allowedPaymentMethods = paymentMethods.filter((p) => p.code !== 'ar');
  const defaultMethodIsCounter = allowedPaymentMethods.some((p) => p.id === paymentPolicy.defaultMethodId);
  const defaultPayMethod = (defaultMethodIsCounter ? paymentPolicy.defaultMethodId : null)
    ?? allowedPaymentMethods.find((p) => p.code === 'cash')?.id
    ?? allowedPaymentMethods[0]?.id
    ?? '';
  const [payMode, setPayMode] = useState<'split' | 'together'>('split');
  const [feedbackItem, setFeedbackItem] = useState<OrderItem | null>(null);
  const [interruptItem, setInterruptItem] = useState<OrderItem | null>(null);
  const [concurrentItem, setConcurrentItem] = useState<OrderItem | null>(null);
  const [confirmFinish, setConfirmFinish] = useState<OrderItem | null>(null);

  const due = Math.max(0, order.total_cents - order.paid_cents);
  const canRunService = ['open', 'in_service'].includes(order.status);

  function doAddCustomer() {
    if (!custName.trim()) return toast.error('Customer name required');
    startTransition(async () => {
      const r = await addOrderCustomer({
        order_id: order.id,
        customer_name: custName,
        customer_phone: custPhone || null,
      });
      if (r.ok) { setCustName(''); setCustPhone(''); toast.success('Customer added'); }
      else toast.error(r.error);
    });
  }

  function doAddItem(customerId: string) {
    if (!svcId) return toast.error('Pick a service');
    startTransition(async () => {
      const r = await addOrderItem({
        order_id: order.id,
        order_customer_id: customerId,
        service_item_id: svcId,
        therapist_id: therapistId === NONE ? null : therapistId,
        resource_id: resourceId === NONE ? null : resourceId,
        discount_class_id: sourceDiscountLocked ? defaultDiscountId : discountId,
        discount_override: needsDiscountAmount ? Number(discountOverride || 0) : null,
      });
      if (r.ok) { setSvcId(''); setGroupSel(''); setDiscountId(defaultDiscountId); setDiscountOverride(''); setActiveCustomer(null); toast.success('Service added'); }
      else toast.error(r.error);
    });
  }

  // Pick the first free therapist + a matching free station for this line.
  // "Free" = not mid-service anywhere, and not already taken by another live
  // line on this same order. Station type is matched to the service when known.
  function autoAssign() {
    const takenTherapists = new Set<string>(busyTherapistIds);
    const takenStations = new Set<string>(busyResourceIds);
    items
      .filter((i) => ['scheduled', 'in_service'].includes(i.status))
      .forEach((i) => {
        if (i.therapist_id) takenTherapists.add(i.therapist_id);
        if (i.resource_id) takenStations.add(i.resource_id);
      });

    const neededGroup = serviceItems.find((s) => s.id === svcId)?.group ?? groupSel;
    const freeTherapist = employees.find(
      (e) => !takenTherapists.has(e.id) && (!neededGroup || (capabilityByEmployee[e.id] ?? []).includes(neededGroup)),
    );
    const neededType = serviceItems.find((s) => s.id === svcId)?.required_resource_type ?? null;
    const freeStation = resources.find(
      (r) => !takenStations.has(r.id) && (!neededType || r.resource_type === neededType),
    );

    if (freeTherapist) setTherapistId(freeTherapist.id);
    if (freeStation) setResourceId(freeStation.id);

    if (freeTherapist && freeStation) {
      toast.success(`Auto-assigned ${freeTherapist.name} · ${freeStation.name}`);
    } else if (!freeTherapist && !freeStation) {
      toast.error('No free therapist at this branch or station — borrow a therapist manually if needed');
    } else if (!freeTherapist) {
      toast.warning(`Station ${freeStation!.name} set — no free therapist here, borrow one manually`);
    } else {
      toast.warning(`${freeTherapist!.name} set — no free station${neededType ? ` (${neededType})` : ''}`);
    }
  }

  function doRemoveItem(id: string) {
    startTransition(async () => {
      const r = await removeOrderItem(id, order.id);
      if (!r.ok) toast.error(r.error);
    });
  }

  function startItemNow(id: string, allowConcurrent: boolean) {
    startTransition(async () => {
      const r = await startOrderItem(id, order.id, allowConcurrent);
      if (r.ok) toast.success('Service started'); else toast.error(r.error);
    });
  }

  function doStartAll() {
    startTransition(async () => {
      const r = await startAllServices(order.id);
      if (r.ok) {
        const n = r.data?.started ?? 0;
        toast.success(n > 0 ? `Started ${n} service${n === 1 ? '' : 's'}` : 'Nothing to start');
      } else toast.error(r.error);
    });
  }

  function doStartItem(it: OrderItem) {
    // Same guest already mid-service → confirm before running them in parallel.
    const concurrent = items.some(
      (x) => x.id !== it.id && x.order_customer_id === it.order_customer_id && x.status === 'in_service',
    );
    if (concurrent) { setConcurrentItem(it); return; }
    startItemNow(it.id, false);
  }

  function finishItemNow(id: string) {
    startTransition(async () => {
      const r = await finishOrderItem(id, order.id);
      if (r.ok) toast.success('Service finished'); else toast.error(r.error);
    });
  }

  function doFinishItem(it: OrderItem) {
    // Warn if finishing before the booked duration has elapsed — a 60/90-min
    // service (plus prep) shouldn't realistically finish sooner.
    if (it.actual_start && it.duration_minutes) {
      const elapsedMin = (Date.now() - new Date(it.actual_start).getTime()) / 60000;
      if (elapsedMin < it.duration_minutes) { setConfirmFinish(it); return; }
    }
    finishItemNow(it.id);
  }

  function doSkipItem(id: string) {
    startTransition(async () => {
      const r = await skipOrderItem(id, order.id);
      if (r.ok) toast.success('Service skipped'); else toast.error(r.error);
    });
  }

  function doRemoveCustomer(id: string) {
    startTransition(async () => {
      const r = await removeOrderCustomer(id, order.id);
      if (!r.ok) toast.error(r.error);
    });
  }

  function doVoidPayment(paymentId: string) {
    startTransition(async () => {
      const r = await voidPayment(paymentId, order.id);
      if (r.ok) toast.success('Payment removed');
      else toast.error(r.error);
    });
  }

  const groupOptions = [...new Set(serviceItems.map((s) => s.group))]
    .sort()
    .map((g) => ({ value: g, label: g }));
  const variantOptions = serviceItems
    .filter((s) => s.group === groupSel)
    .map((s) => ({ value: s.id, label: `${s.duration_minutes} min · ${peso0(s.price_cents)}` }));
  const busy = new Set(busyTherapistIds);
  // A therapist is offered only if they can perform the chosen service group.
  // No group picked yet → show everyone (the picker is disabled until a group exists anyway).
  const canDoGroup = (id: string) => !groupSel || (capabilityByEmployee[id] ?? []).includes(groupSel);
  // A therapist mid-service elsewhere can't take a new one — show them but
  // disable so they can't be picked (auto-assign already skips them too).
  const thisBranchOptions = employees
    .filter((e) => canDoGroup(e.id))
    .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}${busy.has(e.id) ? ' · in service' : ''}`, disabled: busy.has(e.id) }));
  const borrowOptions = borrowableEmployees
    .filter((e) => canDoGroup(e.id))
    .map((e) => ({
      value: e.id,
      label: `${e.code} — ${e.name}${e.homeBranchCode ? ` · ${e.homeBranchCode}` : ''}${busy.has(e.id) ? ' · in service' : ''}`,
      disabled: busy.has(e.id),
    }));
  // Combined list drives the trigger's value→label lookup; the dropdown groups them.
  const empOptions = [{ value: NONE, label: 'Unassigned' }, ...thisBranchOptions, ...borrowOptions];
  // A station occupied by an in-service order can't take another — disable it.
  const busyRes = new Set(busyResourceIds);
  const resOptions = [
    { value: NONE, label: 'None', disabled: false },
    ...resources.map((r) => ({ value: r.id, label: `${r.name}${busyRes.has(r.id) ? ' · in use' : ''}`, disabled: busyRes.has(r.id) })),
  ];
  const discRate = (d: DiscountOpt): string | null =>
    d.discount_percent > 0
      ? `${d.discount_percent}%`
      : d.discount_amount_cents > 0
        ? `₱${(d.discount_amount_cents / 100).toLocaleString()}`
        : null;
  const discOptions = discountClasses.map((d) => {
    const rate = discRate(d);
    return { value: d.id, label: rate ? `${d.code} — ${rate} — ${d.description}` : `${d.code} — ${d.description}` };
  });

  const itemsByCustomer = (cid: string) => items.filter((i) => i.order_customer_id === cid);
  const multiCustomer = customers.length > 1;
  // Therapists to tip for a customer (null = whole order): their items that have one.
  const tipTargetsFor = (customerId: string | null): TipTarget[] =>
    items
      .filter((it) => (customerId == null || it.order_customer_id === customerId) && it.therapist_id)
      .map((it) => ({
        orderItemId: it.id,
        therapistId: it.therapist_id as string,
        therapistName: it.therapist_name ?? 'Therapist',
        serviceName: it.service_name,
      }));

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="guests" className="w-full flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="guests"><Users /> Guest List</TabsTrigger>
          <TabsTrigger value="folio"><Receipt /> Folio</TabsTrigger>
          <TabsTrigger value="feedback"><Star /> Feedback</TabsTrigger>
          <TabsTrigger value="history"><History /> Change History</TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="flex flex-col gap-4">
      {/* section header: pax count + add customer */}
      {/* Same column grid as the service rows so "Start all" lands above the Action column. */}
      <div className="grid grid-cols-[11rem_10rem_6rem_15rem_10rem_1fr] items-end gap-x-3 px-4">
        <div className="col-span-4 flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold">Guests</h3>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">{customers.length} pax</span>
          </div>
          {order.editable && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Customer name <span className="text-destructive">*</span></Label>
                <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Name" className="w-44" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Phone</Label>
                <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="optional" className="w-36" />
              </div>
              <Button size="sm" onClick={doAddCustomer} disabled={pending}>
                <UserPlus className="size-4" /> Add Customer
              </Button>
            </div>
          )}
        </div>
        {canRunService && items.some((i) => i.status === 'scheduled') ? (
          <Button size="sm" variant="outline" onClick={doStartAll} disabled={pending}>
            <Play className="size-4" /> Start all
          </Button>
        ) : <span />}
        <span />
      </div>

      {/* customers + items */}
      {customers.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-8 text-center text-sm font-semibold text-muted-foreground">
            No guests yet — add the first using the form above.
          </CardContent>
        </Card>
      ) : (
        customers.sort((a, b) => a.seq_no - b.seq_no).map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{c.seq_no}</span>
                {c.customer_name}
                {c.customer_phone && <span className="font-medium text-muted-foreground">{c.customer_phone}</span>}
              </CardTitle>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold tabular">{peso(c.subtotal_cents)}</span>
                {order.editable && (
                  <Button size="icon-sm" variant="ghost" onClick={() => doRemoveCustomer(c.id)} disabled={pending}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {itemsByCustomer(c.id).length > 0 && (
                <div className="grid grid-cols-[11rem_10rem_6rem_15rem_10rem_1fr] items-center gap-x-3 border-b border-border pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  <span>Service</span>
                  <span>Therapist</span>
                  <span>Status</span>
                  <span>Duration · Station</span>
                  <span>Action</span>
                  <span className="justify-self-end">Amount</span>
                </div>
              )}
              <ul className="flex flex-col divide-y divide-border">
                {itemsByCustomer(c.id).map((it) => {
                  const detailParts = [
                    it.duration_minutes ? `${it.duration_minutes} min` : null,
                    it.station_name,
                    timeWindow(it.actual_start, it.actual_end, it.duration_minutes),
                  ].filter(Boolean) as string[];
                  const statusTag =
                    it.status === 'in_service' ? { t: 'In service', c: 'text-blue-600 dark:text-blue-400' }
                    : (it.status === 'service_completed' || it.status === 'feedback_done') ? { t: 'Done', c: 'text-primary' }
                    : it.status === 'interrupted' ? { t: 'Interrupted', c: 'text-destructive' }
                    : it.status === 'cancelled' ? { t: 'Skipped', c: 'text-muted-foreground' }
                    : null;
                  return (
                  <li key={it.id} className={`grid grid-cols-[11rem_10rem_6rem_15rem_10rem_1fr] items-center gap-x-3 py-2 text-sm ${it.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    <span className="font-semibold truncate">{it.service_name}</span>
                    <span className="font-medium text-muted-foreground truncate">
                      {it.therapist_name ?? 'Unassigned'}
                      {it.therapist_home_branch_code && ` · ${it.therapist_home_branch_code}`}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide truncate">
                      {statusTag && <span className={statusTag.c}>{statusTag.t}</span>}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground tabular truncate">
                      {detailParts.join(' · ')}
                    </span>
                    <div className="flex items-center gap-2">
                      {canRunService && it.status === 'scheduled' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => doStartItem(it)} disabled={pending}>Start</Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => doSkipItem(it.id)} disabled={pending}>Skip</Button>
                        </>
                      )}
                      {canRunService && it.status === 'in_service' && (
                        <>
                          <Button size="sm" onClick={() => doFinishItem(it)} disabled={pending}>Finish</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setInterruptItem(it)} disabled={pending}>Interrupt</Button>
                        </>
                      )}
                      {['service_completed', 'feedback_done'].includes(it.status) && it.feedback_score == null && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/60 text-amber-700 hover:text-amber-800 dark:text-amber-400"
                          onClick={() => setFeedbackItem(it)}
                          disabled={pending}
                        >
                          <Star className="size-3.5" /> Feedback
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 justify-self-end">
                      {it.status === 'cancelled' ? (
                        <span className="font-medium tabular line-through text-muted-foreground">{peso(it.final_amount_cents)}</span>
                      ) : (
                        <span className="font-bold tabular">
                          {it.discount_amount_cents > 0 && (
                            <span className="line-through text-muted-foreground font-medium mr-1">{peso(it.list_price_cents)}</span>
                          )}
                          {peso(it.final_amount_cents)}
                        </span>
                      )}
                      {order.editable && (
                        <Button size="icon-sm" variant="ghost" onClick={() => doRemoveItem(it.id)} disabled={pending}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </li>
                  );
                })}
                {itemsByCustomer(c.id).length === 0 && (
                  <li className="py-2 text-sm font-medium text-muted-foreground">No services yet</li>
                )}
              </ul>

              {order.editable && (
                activeCustomer === c.id ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-border p-3">
                    <div className="max-w-[15rem]">
                      <Label className="text-xs font-semibold">Service</Label>
                      <Select
                        items={groupOptions}
                        value={groupSel}
                        onValueChange={(v) => { if (v) { setGroupSel(v); setSvcId(''); setTherapistId(NONE); } }}
                      >
                        <SelectTrigger><SelectValue placeholder="Pick a service" /></SelectTrigger>
                        <SelectContent>
                          {groupOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="max-w-[15rem]">
                      <Label className="text-xs font-semibold">Duration</Label>
                      <Select
                        items={variantOptions}
                        value={svcId}
                        onValueChange={(v) => v && setSvcId(v)}
                        disabled={!groupSel}
                      >
                        <SelectTrigger><SelectValue placeholder={groupSel ? 'Pick duration' : 'Pick service first'} /></SelectTrigger>
                        <SelectContent>
                          {variantOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="max-w-[15rem]">
                      <Label className="text-xs font-semibold">Discount</Label>
                      <Select items={discOptions} value={sourceDiscountLocked ? defaultDiscountId : discountId} onValueChange={(v) => v && setDiscountId(v)} disabled={sourceDiscountLocked}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {discOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {sourceDiscountLocked && (
                        <p className="text-[11px] font-medium text-muted-foreground mt-1">Set by customer source (group rate)</p>
                      )}
                    </div>
                    {needsDiscountAmount && (
                      <div>
                        <Label className="text-xs font-semibold">{selectedDiscountCode} amount (₱) *</Label>
                        <Input type="number" min="0" step="0.01" value={discountOverride} onChange={(e) => setDiscountOverride(e.target.value)} placeholder="manager-set" />
                      </div>
                    )}
                    <div className="col-span-3 -mx-3 px-3 py-3 bg-muted/40 border-y border-border flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs font-semibold text-muted-foreground">Therapist &amp; Station</Label>
                        <Button type="button" size="sm" variant="outline" onClick={autoAssign} disabled={pending}>
                          <Wand2 className="size-3.5" /> Auto-assign
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="max-w-[15rem]">
                          <Label className="text-xs font-semibold">Therapist</Label>
                          <Select items={empOptions} value={therapistId} onValueChange={(v) => setTherapistId(v ?? NONE)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Unassigned</SelectItem>
                              <SelectGroup>
                                <SelectLabel>At this branch</SelectLabel>
                                {thisBranchOptions.length === 0 ? (
                                  <SelectItem value="__nobody__" disabled>{groupSel ? `No therapist here can do ${groupSel}` : 'No therapist rostered here'}</SelectItem>
                                ) : (
                                  thisBranchOptions.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)
                                )}
                              </SelectGroup>
                              {borrowOptions.length > 0 && (
                                <>
                                  <SelectSeparator />
                                  <SelectGroup>
                                    <SelectLabel>Borrow from other branch</SelectLabel>
                                    {borrowOptions.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
                                  </SelectGroup>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="max-w-[15rem]">
                          <Label className="text-xs font-semibold">Station</Label>
                          <Select items={resOptions} value={resourceId} onValueChange={(v) => setResourceId(v ?? NONE)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {resOptions.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-3 flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setActiveCustomer(null)} disabled={pending}>Cancel</Button>
                      <Button size="sm" onClick={() => doAddItem(c.id)} disabled={pending || !svcId}>Add</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setActiveCustomer(c.id)}>
                    <Plus className="size-4" /> Add Service
                  </Button>
                )
              )}
            </CardContent>
          </Card>
        ))
      )}
        </TabsContent>

        <TabsContent value="folio" className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total charges</p><p className="text-xl font-extrabold tabular mt-1">{peso(order.total_cents)}</p></CardContent></Card>
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Paid</p><p className="text-xl font-extrabold tabular mt-1">{peso(order.paid_cents)}</p></CardContent></Card>
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Outstanding</p><p className="text-xl font-extrabold tabular mt-1">{peso(due)}</p></CardContent></Card>
          </div>

      {/* AR-billed orders are invoiced, not collected at the counter */}
      {paymentPolicy.arBilled && ['completed', 'paid'].includes(order.status) && (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-3 text-sm font-medium text-muted-foreground">
            Billed to <span className="font-bold text-foreground">{paymentPolicy.arBillingLabel ?? 'AR'}</span> via AR —
            no counter payment. Closed at the daily Revenue Confirm and settled on the monthly Revenue SOA.
          </CardContent>
        </Card>
      )}

      {/* payment (counter-paid orders only) */}
      {!paymentPolicy.arBilled && ['completed', 'paid'].includes(order.status) && (due > 0 || payments.length > 0) && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <CreditCard className="size-4" /> {due > 0 ? `Take Payment · Due ${peso(due)}` : 'Payments'}
            </CardTitle>
            {due > 0 && multiCustomer && (
              <div className="inline-flex rounded-lg border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setPayMode('split')}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-bold transition-colors',
                    payMode === 'split' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  Pay separately
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('together')}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-bold transition-colors',
                    payMode === 'together' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  Pay together
                </button>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {due > 0 &&
              (multiCustomer && payMode === 'split' ? (
                customers
                  .slice()
                  .sort((a, b) => a.seq_no - b.seq_no)
                  .filter((c) => c.subtotal_cents - c.paid_cents > 0)
                  .map((c) => (
                    <CustomerPaymentCard
                      key={c.id}
                      orderId={order.id}
                      orderCustomerId={c.id}
                      label={`#${c.seq_no} · ${c.customer_name}`}
                      dueCents={c.subtotal_cents - c.paid_cents}
                      tipTargets={tipTargetsFor(c.id)}
                      paymentMethods={allowedPaymentMethods}
                      storedValueCards={storedValueCards}
                      locked={false}
                      defaultMethodId={defaultPayMethod}
                    />
                  ))
              ) : (
                <CustomerPaymentCard
                  orderId={order.id}
                  orderCustomerId={multiCustomer ? null : customers[0]?.id ?? null}
                  label={multiCustomer ? 'Whole order' : 'Payment'}
                  dueCents={due}
                  tipTargets={tipTargetsFor(multiCustomer ? null : customers[0]?.id ?? null)}
                  paymentMethods={allowedPaymentMethods}
                  storedValueCards={storedValueCards}
                  locked={false}
                  defaultMethodId={defaultPayMethod}
                />
              ))}

            {payments.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Recorded payments</p>
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-semibold">{p.method_name}</span>
                      {p.customer_label && <span className="ml-2 font-medium text-muted-foreground">{p.customer_label}</span>}
                      {p.payment_ref && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.payment_ref}</span>}
                      {p.tip_cents > 0 && <span className="ml-2 text-xs font-semibold text-primary">+ tip {peso(p.tip_cents)}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold tabular">{peso(p.amount_cents)}</span>
                      {(order.status !== 'paid' || canManage) && (
                        <Button size="icon-sm" variant="ghost" onClick={() => doVoidPayment(p.id)} disabled={pending} title="Remove payment">
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="feedback" className="flex flex-col gap-2">
          {items.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground px-1">No services yet.</p>
          ) : (
            <Card>
              <CardContent className="py-2 flex flex-col divide-y divide-border">
                {items.map((it) => (
                  <div key={it.id} className={`flex items-center justify-between py-2 text-sm ${it.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    <span className="font-semibold">{it.service_name}<span className="ml-2 font-medium text-muted-foreground">{it.therapist_name ?? 'Unassigned'}</span></span>
                    {it.status === 'cancelled'
                      ? <span className="text-xs font-medium text-muted-foreground">Skipped</span>
                      : it.feedback_score != null
                        ? <span className="font-bold text-amber-600 dark:text-amber-400">★ {it.feedback_score}/10</span>
                        : <span className="text-xs font-medium text-muted-foreground">Not submitted</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          {history.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground px-1">No changes logged yet.</p>
          ) : (
            <Card>
              <CardContent className="py-3">
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
        </TabsContent>
      </Tabs>

      {feedbackItem && (
        <FeedbackDialog
          orderId={order.id}
          orderItemId={feedbackItem.id}
          serviceName={feedbackItem.service_name}
          therapistName={feedbackItem.therapist_name}
          open={!!feedbackItem}
          onOpenChange={(o) => { if (!o) setFeedbackItem(null); }}
        />
      )}
      {interruptItem && (
        <InterruptDialog
          orderId={order.id}
          itemId={interruptItem.id}
          serviceName={interruptItem.service_name}
          open={!!interruptItem}
          onOpenChange={(o) => { if (!o) setInterruptItem(null); }}
        />
      )}

      <AlertDialog open={!!concurrentItem} onOpenChange={(o) => { if (!o) setConcurrentItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start at the same time?</AlertDialogTitle>
            <AlertDialogDescription>
              This guest already has a service in progress. Start <strong>{concurrentItem?.service_name}</strong> in parallel?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (concurrentItem) startItemNow(concurrentItem.id, true); setConcurrentItem(null); }}
            >
              Start in parallel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmFinish} onOpenChange={(o) => { if (!o) setConfirmFinish(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish early?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmFinish?.service_name}</strong> has run only{' '}
              <strong>
                {confirmFinish?.actual_start
                  ? Math.max(0, Math.floor((Date.now() - new Date(confirmFinish.actual_start).getTime()) / 60000))
                  : 0} min
              </strong>{' '}
              of its <strong>{confirmFinish?.duration_minutes} min</strong> booking. Finish it now anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmFinish) finishItemNow(confirmFinish.id); setConfirmFinish(null); }}
            >
              Finish anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
