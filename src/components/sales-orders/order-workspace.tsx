'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2, UserPlus, CreditCard, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  finishOrderItem,
  setOrderStatus,
  voidPayment,
  voidOrder,
  reopenOrder,
} from '@/app/(dashboard)/sales-orders/actions';
import { CustomerPaymentCard, type TipTarget } from '@/components/sales-orders/customer-payment-card';
import { ReasonDialog } from '@/components/sales-orders/reason-dialog';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

interface OrderItem {
  id: string;
  order_customer_id: string;
  service_name: string;
  therapist_name: string | null;
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
interface DiscountOpt { id: string; code: string; description: string }
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
    total_cents: number;
    paid_cents: number;
    editable: boolean;
  };
  customers: OrderCustomer[];
  items: OrderItem[];
  payments: PaymentRecord[];
  serviceItems: ServiceVariant[];
  employees: Opt[];
  borrowableEmployees: BorrowOpt[];
  busyTherapistIds: string[];
  busyResourceIds: string[];
  resources: ResourceOpt[];
  discountClasses: DiscountOpt[];
  paymentMethods: { id: string; code: string; display_name: string }[];
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

export function OrderWorkspace({
  order,
  customers,
  items,
  payments,
  serviceItems,
  employees,
  borrowableEmployees,
  busyTherapistIds,
  busyResourceIds,
  resources,
  discountClasses,
  paymentMethods,
  paymentPolicy,
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
  const [discountId, setDiscountId] = useState(noDiscount?.id ?? discountClasses[0]?.id ?? '');

  // Counter payment methods only — AR is an invoice arrangement, not a counter
  // collection, so it is never offered here. AR-billed orders skip payment.
  const allowedPaymentMethods = paymentMethods.filter((p) => p.code !== 'ar');
  const defaultMethodIsCounter = allowedPaymentMethods.some((p) => p.id === paymentPolicy.defaultMethodId);
  const defaultPayMethod = (defaultMethodIsCounter ? paymentPolicy.defaultMethodId : null)
    ?? allowedPaymentMethods.find((p) => p.code === 'cash')?.id
    ?? allowedPaymentMethods[0]?.id
    ?? '';
  const [payMode, setPayMode] = useState<'split' | 'together'>('split');
  const [voidOpen, setVoidOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

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
        discount_class_id: discountId,
      });
      if (r.ok) { setSvcId(''); setGroupSel(''); setActiveCustomer(null); toast.success('Service added'); }
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

    const freeTherapist = employees.find((e) => !takenTherapists.has(e.id));
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

  function doStartItem(id: string) {
    startTransition(async () => {
      const r = await startOrderItem(id, order.id);
      if (r.ok) toast.success('Service started'); else toast.error(r.error);
    });
  }

  function doFinishItem(id: string) {
    startTransition(async () => {
      const r = await finishOrderItem(id, order.id);
      if (r.ok) toast.success('Service finished'); else toast.error(r.error);
    });
  }

  function doRemoveCustomer(id: string) {
    startTransition(async () => {
      const r = await removeOrderCustomer(id, order.id);
      if (!r.ok) toast.error(r.error);
    });
  }

  function doStatus(next: string) {
    startTransition(async () => {
      const r = await setOrderStatus(order.id, next);
      if (r.ok) toast.success(`Order ${next.replace('_', ' ')}`);
      else toast.error(r.error);
    });
  }

  function doVoidPayment(paymentId: string) {
    startTransition(async () => {
      const r = await voidPayment(paymentId, order.id);
      if (r.ok) toast.success('Payment removed');
      else toast.error(r.error);
    });
  }

  function doVoid(reason: string) {
    startTransition(async () => {
      const r = await voidOrder(order.id, reason);
      if (r.ok) { toast.success('Order voided'); setVoidOpen(false); }
      else toast.error(r.error);
    });
  }

  function doReopen(reason: string) {
    startTransition(async () => {
      const r = await reopenOrder(order.id, reason);
      if (r.ok) { toast.success('Order reopened'); setReopenOpen(false); }
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
  const thisBranchOptions = employees.map((e) => ({ value: e.id, label: `${e.code} — ${e.name}${busy.has(e.id) ? ' · in service' : ''}` }));
  const borrowOptions = borrowableEmployees.map((e) => ({
    value: e.id,
    label: `${e.code} — ${e.name}${e.homeBranchCode ? ` · ${e.homeBranchCode}` : ''}${busy.has(e.id) ? ' · in service' : ''}`,
  }));
  // Combined list drives the trigger's value→label lookup; the dropdown groups them.
  const empOptions = [{ value: NONE, label: 'Unassigned' }, ...thisBranchOptions, ...borrowOptions];
  const resOptions = [{ value: NONE, label: 'None' }, ...resources.map((r) => ({ value: r.id, label: r.name }))];
  const discOptions = discountClasses.map((d) => ({ value: d.id, label: `${d.code} — ${d.description}` }));

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
      {/* status actions */}
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold capitalize mr-2">Status: {order.status.replace('_', ' ')}</span>
          {order.status === 'draft' && (
            <Button size="sm" onClick={() => doStatus('open')} disabled={pending || items.length === 0}>Open Order</Button>
          )}
          {order.status === 'open' && (
            <Button size="sm" onClick={() => doStatus('in_service')} disabled={pending}>Start Service</Button>
          )}
          {order.status === 'in_service' && (
            <Button size="sm" onClick={() => doStatus('completed')} disabled={pending}>Complete</Button>
          )}
          {order.status === 'paid' && (
            <span className="text-xs font-medium text-muted-foreground">Paid — closes at daily Revenue Confirm</span>
          )}
          {order.status === 'completed' && canManage && (
            <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)} disabled={pending}>
              Reopen
            </Button>
          )}
          {!['closed', 'void'].includes(order.status) && canManage && (
            <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => setVoidOpen(true)} disabled={pending}>
              Void
            </Button>
          )}
        </CardContent>
      </Card>

      {/* add customer */}
      {order.editable && (
        <Card className="border-dashed">
          <CardContent className="py-3 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Customer name</Label>
              <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Walk-in guest" className="w-48" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Phone</Label>
              <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="optional" className="w-40" />
            </div>
            <Button size="sm" onClick={doAddCustomer} disabled={pending}>
              <UserPlus className="size-4" /> Add Customer
            </Button>
          </CardContent>
        </Card>
      )}

      {/* customers + items */}
      {customers.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground px-1">No customers yet — add the first above.</p>
      ) : (
        customers.sort((a, b) => a.seq_no - b.seq_no).map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold">
                #{c.seq_no} · {c.customer_name}
                {c.customer_phone && <span className="ml-2 font-medium text-muted-foreground">{c.customer_phone}</span>}
              </CardTitle>
              {order.editable && (
                <Button size="icon-sm" variant="ghost" onClick={() => doRemoveCustomer(c.id)} disabled={pending}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {itemsByCustomer(c.id).map((it) => {
                  const detailParts = [
                    it.duration_minutes ? `${it.duration_minutes} min` : null,
                    it.station_name,
                    it.actual_start ? `${hm(it.actual_start)}${it.actual_end ? `–${hm(it.actual_end)}` : ''}` : null,
                  ].filter(Boolean) as string[];
                  return (
                  <li key={it.id} className="flex items-center justify-between py-2 text-sm gap-2">
                    <div className="min-w-0">
                      <div>
                        <span className="font-semibold">{it.service_name}</span>
                        <span className="ml-2 font-medium text-muted-foreground">{it.therapist_name ?? 'Unassigned'}</span>
                        {it.status === 'in_service' && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">In service</span>
                        )}
                        {it.status === 'service_completed' && (
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-primary">Done</span>
                        )}
                      </div>
                      {detailParts.length > 0 && (
                        <div className="text-xs font-medium text-muted-foreground mt-0.5 tabular">
                          {detailParts.join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canRunService && it.status === 'scheduled' && (
                        <Button size="sm" variant="outline" onClick={() => doStartItem(it.id)} disabled={pending}>Start</Button>
                      )}
                      {canRunService && it.status === 'in_service' && (
                        <Button size="sm" onClick={() => doFinishItem(it.id)} disabled={pending}>Finish</Button>
                      )}
                      <span className="font-bold tabular">
                        {it.discount_amount_cents > 0 && (
                          <span className="line-through text-muted-foreground font-medium mr-1">{peso(it.list_price_cents)}</span>
                        )}
                        {peso(it.final_amount_cents)}
                      </span>
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
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border p-3">
                    <div>
                      <Label className="text-xs font-semibold">Service</Label>
                      <Select
                        items={groupOptions}
                        value={groupSel}
                        onValueChange={(v) => { if (v) { setGroupSel(v); setSvcId(''); } }}
                      >
                        <SelectTrigger><SelectValue placeholder="Pick a service" /></SelectTrigger>
                        <SelectContent>
                          {groupOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
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
                    <div className="col-span-2 flex items-center justify-between">
                      <Label className="text-xs font-semibold text-muted-foreground">Therapist &amp; Station</Label>
                      <Button type="button" size="sm" variant="outline" onClick={autoAssign} disabled={pending}>
                        <Wand2 className="size-3.5" /> Auto-assign
                      </Button>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Therapist</Label>
                      <Select items={empOptions} value={therapistId} onValueChange={(v) => setTherapistId(v ?? NONE)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Unassigned</SelectItem>
                          <SelectGroup>
                            <SelectLabel>At this branch</SelectLabel>
                            {thisBranchOptions.length === 0 ? (
                              <SelectItem value="__nobody__" disabled>No therapist rostered here</SelectItem>
                            ) : (
                              thisBranchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)
                            )}
                          </SelectGroup>
                          {borrowOptions.length > 0 && (
                            <>
                              <SelectSeparator />
                              <SelectGroup>
                                <SelectLabel>Borrow from other branch</SelectLabel>
                                {borrowOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectGroup>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Station</Label>
                      <Select items={resOptions} value={resourceId} onValueChange={(v) => setResourceId(v ?? NONE)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {resOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs font-semibold">Discount</Label>
                      <Select items={discOptions} value={discountId} onValueChange={(v) => v && setDiscountId(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {discOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 flex gap-2 justify-end">
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
                      <Button size="icon-sm" variant="ghost" onClick={() => doVoidPayment(p.id)} disabled={pending} title="Remove payment">
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ReasonDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this order?"
        description="The order is cancelled and locked. Past activity is kept."
        confirmLabel="Void order"
        destructive
        pending={pending}
        onConfirm={doVoid}
      />
      <ReasonDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reopen this order?"
        description="Moves the order back to Open so it can be edited. Logged for audit."
        confirmLabel="Reopen"
        pending={pending}
        onConfirm={doReopen}
      />
    </div>
  );
}
