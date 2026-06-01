'use client';

import { type ComponentProps, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, UserPlus, CreditCard, Wand2, Users, Receipt, Star, History, Play, Pencil, Check, X } from 'lucide-react';
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
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
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
  updateOrderCustomer,
  addOrderItem,
  updateOrderItem,
  removeOrderItem,
  startOrderItem,
  startAllServices,
  finishOrderItem,
  skipOrderItem,
  redoOrderItem,
  switchService,
  releaseBed,
  voidPayment,
} from '@/app/(dashboard)/sales-orders/actions';
import { CustomerPaymentCard, type TipTarget } from '@/components/sales-orders/customer-payment-card';
import { FeedbackDialog } from '@/components/sales-orders/feedback-dialog';
import { AuditTrail } from '@/components/sales-orders/audit-trail';
import { InterruptDialog } from '@/components/sales-orders/interrupt-dialog';
import { ANY_GENDER, canPerformGroup, matchesGender } from '@/lib/therapist-availability';
import { RESOURCE_TYPE_LABEL } from '@/lib/resource-types';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

interface OrderItem {
  id: string;
  order_customer_id: string;
  service_item_id: string;
  discount_class_id: string | null;
  service_name: string;
  therapist_name: string | null;
  therapist_home_branch_code: string | null;
  therapist_id: string | null;
  resource_id: string | null;
  station_name: string | null;
  duration_minutes: number | null;
  prep_minutes: number;
  cleanup_minutes: number;
  actual_start: string | null;
  actual_end: string | null;
  bed_released_at: string | null;
  list_price_cents: number;
  discount_amount_cents: number;
  final_amount_cents: number;
  status: string;
  switched: boolean;
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
interface Opt { id: string; code: string; name: string; gender?: string | null; visiting?: boolean }
interface BorrowOpt { id: string; code: string; name: string; gender?: string | null; homeBranchCode: string | null }
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
  /** Rich per-row audit trail (orders + items + customers + payments + tips
   *  + feedback) — feeds the Change History tab's timeline + diff UI. The
   *  legacy `history` prop stays for the curated status-only narrative
   *  (status_log + edit_log entries) that the tab still optionally shows. */
  auditTrail: import('@/lib/order-audit-trail').AuditEntry[];
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
  defaultGenderPref?: string | null; // from the source reservation, if any
  paymentPolicy: { arBilled: boolean; defaultMethodId: string | null; arBillingLabel: string | null };
  /** Active managers with a PIN set — drives the inline approval picker
   *  when staff picks No charge on the Interrupt dialog. */
  pinManagers: { id: string; name: string }[];
  /** Whether the caller is themselves manager+ — when true the PIN section
   *  hides (server records them as approver automatically). */
  viewerIsManager: boolean;
}

const NONE = '__none__';
const GENDER_OPTS = [
  { value: ANY_GENDER, label: 'Any gender' },
  { value: 'F', label: 'Female only' },
  { value: 'M', label: 'Male only' },
];

function peso0(cents: number | null): string {
  return cents == null ? '—' : `${(cents / 100).toLocaleString('en-PH')}`;
}

function hm(ts: string | null): string {
  return ts ? new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }) : '';
}

// Time window for a service line: actual once finished, else the projected end
// while it's running. The bed is occupied for prep + service, so the projected
// end folds prep in. Nothing before it's started.
function timeWindow(actualStart: string | null, actualEnd: string | null, durationMin: number | null, prepMin: number): string | null {
  if (!actualStart) return null;
  if (actualEnd) return `${hm(actualStart)}–${hm(actualEnd)}`;
  const occ = (durationMin ?? 0) + (prepMin ?? 0);
  if (occ > 0) {
    const end = new Date(new Date(actualStart).getTime() + occ * 60000).toISOString();
    return `${hm(actualStart)}–~${hm(end)}`;
  }
  return hm(actualStart);
}

// A service-line action button with a colour + a hover tooltip explaining it.
function ActionBtn({ tip, children, ...props }: { tip: string } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="sm" {...props}>{children}</Button>} />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function OrderWorkspace({
  order,
  customers,
  items,
  payments,
  history,
  auditTrail,
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
  pinManagers,
  viewerIsManager,
  capabilityByEmployee,
  defaultGenderPref = null,
}: Props) {
  const [pending, startTransition] = useTransition();

  // Active workspace tab. Auto-jumps to Folio the moment the order completes
  // (all services done) so the desk lands on payment without an extra click.
  const [tab, setTab] = useState('guests');
  const prevStatus = useRef(order.status);
  useEffect(() => {
    if (prevStatus.current !== 'completed' && order.status === 'completed') setTab('folio');
    prevStatus.current = order.status;
  }, [order.status]);

  // add customer
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  // inline rename of an existing guest (fill in a converted "Guest 2" placeholder)
  const [editCust, setEditCust] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // add item (per customer) — two-step: group → duration variant. The same panel
  // edits an existing not-yet-started line when editingItemId is set.
  const [activeCustomer, setActiveCustomer] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [groupSel, setGroupSel] = useState('');
  const [svcId, setSvcId] = useState('');
  const [therapistId, setTherapistId] = useState(NONE);
  const [resourceId, setResourceId] = useState(NONE);
  // Default the line's gender filter from the reservation (M/F), else Any.
  const initialGenderPref = defaultGenderPref === 'M' || defaultGenderPref === 'F' ? defaultGenderPref : ANY_GENDER;
  const [genderPref, setGenderPref] = useState(initialGenderPref);
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
  const allowedPaymentMethods = paymentMethods.filter((p) => p.code?.toLowerCase() !== 'ar');
  const defaultMethodIsCounter = allowedPaymentMethods.some((p) => p.id === paymentPolicy.defaultMethodId);
  const defaultPayMethod = (defaultMethodIsCounter ? paymentPolicy.defaultMethodId : null)
    ?? allowedPaymentMethods.find((p) => p.code?.toLowerCase() === 'cash')?.id
    ?? allowedPaymentMethods[0]?.id
    ?? '';
  const [payMode, setPayMode] = useState<'split' | 'together'>('split');
  const [feedbackItem, setFeedbackItem] = useState<OrderItem | null>(null);
  const [interruptItem, setInterruptItem] = useState<OrderItem | null>(null);
  const [confirmFinish, setConfirmFinish] = useState<OrderItem | null>(null);
  const [cancelItem, setCancelItem] = useState<OrderItem | null>(null);
  const [voidPaymentId, setVoidPaymentId] = useState<string | null>(null);
  const router = useRouter();

  const due = Math.max(0, order.total_cents - order.paid_cents);
  const totalTips = payments.reduce((s, p) => s + p.tip_cents, 0);
  const canRunService = ['open', 'in_service'].includes(order.status);

  function doAddCustomer() {
    if (!custName.trim()) return toast.error('Customer name required');
    startTransition(async () => {
      const r = await addOrderCustomer({
        order_id: order.id,
        customer_name: custName,
        customer_phone: custPhone || null,
      });
      if (r.ok) { setCustName(''); setCustPhone(''); toast.success('Customer added'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  function closeItemForm() {
    setActiveCustomer(null);
    setEditingItemId(null);
    setSvcId(''); setGroupSel(''); setDiscountId(defaultDiscountId); setDiscountOverride('');
    setTherapistId(NONE); setResourceId(NONE); setGenderPref(initialGenderPref);
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
      if (r.ok) { closeItemForm(); toast.success('Service added'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Open the shared panel pre-filled to edit an existing (not-yet-started) line.
  function startEditItem(it: OrderItem) {
    const grp = serviceItems.find((s) => s.id === it.service_item_id)?.group ?? '';
    setEditingItemId(it.id);
    setActiveCustomer(it.order_customer_id);
    setGroupSel(grp);
    setSvcId(it.service_item_id);
    setTherapistId(it.therapist_id ?? NONE);
    setResourceId(it.resource_id ?? NONE);
    setDiscountId(it.discount_class_id ?? defaultDiscountId);
    setDiscountOverride(it.discount_amount_cents > 0 ? String(it.discount_amount_cents / 100) : '');
    setGenderPref(initialGenderPref);
  }

  function doSaveItem() {
    if (!editingItemId) return;
    if (!svcId) return toast.error('Pick a service');
    startTransition(async () => {
      const r = await updateOrderItem({
        id: editingItemId,
        order_id: order.id,
        service_item_id: svcId,
        therapist_id: therapistId === NONE ? null : therapistId,
        resource_id: resourceId === NONE ? null : resourceId,
        discount_class_id: sourceDiscountLocked ? defaultDiscountId : discountId,
        discount_override: needsDiscountAmount ? Number(discountOverride || 0) : null,
      });
      if (r.ok) { closeItemForm(); toast.success('Service updated'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Pick the first free therapist + a matching free station for this line.
  // "Free" = not mid-service anywhere, and not already taken by another live
  // line on this same order. Station type is matched to the service when known.
  //
  // Honour what's already there: a station / therapist that's been set by an
  // earlier flow (e.g. carried over from a reservation that already pinned
  // Bed #6) is kept as-is. Auto-assign only fills empty slots. That way the
  // operator can click the button as a "fill in whatever's still blank" shortcut
  // without it silently overriding pre-committed allocations.
  function autoAssign() {
    const hasTherapist = !!therapistId;
    const hasStation = !!resourceId;
    if (hasTherapist && hasStation) {
      toast.info('Therapist and station already set — nothing to auto-assign');
      return;
    }

    const takenTherapists = new Set<string>(busyTherapistIds);
    const takenStations = new Set<string>(busyResourceIds);
    items
      .filter((i) => ['scheduled', 'in_service'].includes(i.status))
      .forEach((i) => {
        if (i.therapist_id) takenTherapists.add(i.therapist_id);
        if (i.resource_id) takenStations.add(i.resource_id);
      });

    const neededGroup = serviceItems.find((s) => s.id === svcId)?.group ?? groupSel;
    const matchTherapist = (e: { id: string; gender?: string | null }) =>
      !takenTherapists.has(e.id)
      && canPerformGroup(capabilityByEmployee[e.id] ?? [], neededGroup)
      && matchesGender(e.gender, genderPref);
    // Priority: this branch's own (home) therapists → others on a cross-branch
    // shift here → borrow from the sharing group. A home therapist is always
    // preferred over someone just visiting or borrowed.
    const ownHomeFree = employees.find((e) => !e.visiting && matchTherapist(e));
    const ownVisitingFree = ownHomeFree ? undefined : employees.find((e) => e.visiting && matchTherapist(e));
    const borrowedFree = ownHomeFree || ownVisitingFree ? undefined : borrowableEmployees.find(matchTherapist);
    const freeTherapist = ownHomeFree ?? ownVisitingFree ?? borrowedFree;
    const note = ownVisitingFree ? ' (visiting)' : borrowedFree?.homeBranchCode ? ` (borrowed · ${borrowedFree.homeBranchCode})` : '';
    const neededType = serviceItems.find((s) => s.id === svcId)?.required_resource_type ?? null;
    const freeStation = resources.find(
      (r) => !takenStations.has(r.id) && (!neededType || r.resource_type === neededType),
    );

    // Only set fields that were empty — preserves the pinned bed from the
    // reservation (or any earlier manual pick) instead of overwriting it.
    const setTherapistNow = !hasTherapist && !!freeTherapist;
    const setStationNow = !hasStation && !!freeStation;
    if (setTherapistNow) setTherapistId(freeTherapist!.id);
    if (setStationNow) setResourceId(freeStation!.id);

    // Build a contextual toast: only mention the fields that were actually
    // changed; warn about anything that's still missing.
    const changed: string[] = [];
    if (setTherapistNow) changed.push(`${freeTherapist!.name}${note}`);
    if (setStationNow) changed.push(freeStation!.name);
    const missingTherapist = !hasTherapist && !freeTherapist;
    const missingStation = !hasStation && !freeStation;

    if (changed.length === 2) {
      toast.success(`Auto-assigned ${changed.join(' · ')}`);
    } else if (changed.length === 1 && !missingTherapist && !missingStation) {
      toast.success(`Auto-assigned ${changed[0]}${hasTherapist ? ' (therapist kept)' : ' (station kept)'}`);
    } else if (changed.length === 1) {
      toast.warning(`${changed[0]} set — ${missingTherapist ? 'no free therapist (own or borrowable)' : `no free station${neededType ? ` (${neededType})` : ''}`}`);
    } else if (missingTherapist && missingStation) {
      toast.error('No free therapist (own or borrowable) or station');
    } else if (missingTherapist) {
      toast.error('No free therapist (own or borrowable)');
    } else if (missingStation) {
      toast.error(`No free station${neededType ? ` (${neededType})` : ''}`);
    }
  }

  function startEditCustomer(c: { id: string; customer_name: string; customer_phone: string | null }) {
    setEditCust(c.id);
    setEditName(c.customer_name);
    setEditPhone(c.customer_phone ?? '');
  }
  function doRenameCustomer() {
    if (!editCust) return;
    if (!editName.trim()) return toast.error('Customer name required');
    startTransition(async () => {
      const r = await updateOrderCustomer({
        id: editCust,
        order_id: order.id,
        customer_name: editName,
        customer_phone: editPhone || null,
      });
      if (r.ok) { setEditCust(null); toast.success('Guest updated'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  function doRemoveItem(id: string) {
    startTransition(async () => {
      const r = await removeOrderItem(id, order.id);
      if (!r.ok) toast.error(r.error);
    });
  }

  function startItemNow(id: string) {
    startTransition(async () => {
      const r = await startOrderItem(id, order.id);
      if (r.ok) { toast.success('Service started'); router.refresh(); } else toast.error(r.error);
    });
  }

  function doStartAll() {
    startTransition(async () => {
      const r = await startAllServices(order.id);
      if (r.ok) {
        const n = r.data?.started ?? 0;
        toast.success(n > 0 ? `Started ${n} service${n === 1 ? '' : 's'}` : 'Nothing to start');
        router.refresh();
      } else toast.error(r.error);
    });
  }

  // One service per guest at a time — the Start button is disabled while this
  // guest has a live service, so just start it.
  function doStartItem(it: OrderItem) {
    startItemNow(it.id);
  }

  function finishItemNow(id: string) {
    startTransition(async () => {
      const r = await finishOrderItem(id, order.id);
      if (r.ok) { toast.success('Service finished'); router.refresh(); } else toast.error(r.error);
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
      if (r.ok) { toast.success('Service cancelled'); router.refresh(); } else toast.error(r.error);
    });
  }

  // Re-add an interrupted/skipped service as a fresh scheduled line (front desk;
  // auto-reopens the order if the interrupt had completed it).
  function doRedoItem(id: string) {
    startTransition(async () => {
      const r = await redoOrderItem(id, order.id);
      if (r.ok) { toast.success('Service re-added with the same therapist & bed — review and Start'); router.refresh(); } else toast.error(r.error);
    });
  }

  // Switch an in-service line to a different service: stop it (no charge) and
  // open the add panel for that guest to pick the replacement.
  function doSwitchItem(it: OrderItem) {
    startTransition(async () => {
      const r = await switchService(it.id, order.id);
      if (r.ok) {
        toast.success('Stopped (no charge) — pick the new service');
        router.refresh();
        setEditingItemId(null);
        setActiveCustomer(it.order_customer_id);
        setSvcId(''); setGroupSel(''); setDiscountId(defaultDiscountId); setDiscountOverride('');
      } else toast.error(r.error);
    });
  }

  function doReleaseBed(id: string) {
    startTransition(async () => {
      const r = await releaseBed(id);
      if (r.ok) { toast.success('Bed marked ready'); router.refresh(); } else toast.error(r.error);
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
      if (r.ok) { toast.success('Payment removed'); router.refresh(); }
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
  const canDoGroup = (id: string) => canPerformGroup(capabilityByEmployee[id] ?? [], groupSel || null);
  // Gender preference for this line: only offer therapists of that gender.
  const genderOf = new Map<string, string | null>([...employees, ...borrowableEmployees].map((e) => [e.id, e.gender ?? null]));
  const matchGender = (id: string) => matchesGender(genderOf.get(id), genderPref);
  // A therapist mid-service elsewhere can't take a new one — show them but
  // disable so they can't be picked (auto-assign already skips them too).
  const thisBranchOptions = employees
    .filter((e) => canDoGroup(e.id) && matchGender(e.id))
    .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}${busy.has(e.id) ? ' · in service' : ''}`, disabled: busy.has(e.id) }));
  const borrowOptions = borrowableEmployees
    .filter((e) => canDoGroup(e.id) && matchGender(e.id))
    .map((e) => ({
      value: e.id,
      label: `${e.code} — ${e.name}${e.homeBranchCode ? ` · ${e.homeBranchCode}` : ''}${busy.has(e.id) ? ' · in service' : ''}`,
      disabled: busy.has(e.id),
    }));
  // Combined list drives the trigger's value→label lookup; the dropdown groups them.
  const empOptions = [{ value: NONE, label: 'Unassigned' }, ...thisBranchOptions, ...borrowOptions];
  // A station occupied by an in-service order can't take another — disable it.
  const busyRes = new Set(busyResourceIds);
  // Filter the station picker by the service's required resource_type so the
  // dropdown only shows stations that can actually do the service (no more
  // "Gel Polish on Massage Bed" because the picker listed every station at
  // the branch). When the service declares no required type (REST or a
  // misc service), fall back to showing every station, grouped by type.
  //
  // We also accept the service GROUP as a fallback: when the user has picked
  // a service group (e.g. Pedicure) but hasn't picked a specific duration
  // variant yet, svcId is still empty — but every variant in the group
  // shares the same required_resource_type, so any representative variant
  // tells us what the picker should filter to.
  const svcSelected = serviceItems.find((s) => s.id === svcId);
  const groupRep = !svcSelected && groupSel
    ? serviceItems.find((s) => s.group === groupSel)
    : null;
  const neededType = (svcSelected ?? groupRep)?.required_resource_type ?? null;
  const eligibleResources = neededType
    ? resources.filter((r) => r.resource_type === neededType)
    : resources;
  // Bucket by type so the dropdown can render one labelled group per type
  // (Massage Beds / Hair Chairs / Nail Stations). Insertion order preserved
  // — the consumer iterates resources as they came in, so the grouping order
  // matches the data's existing sort (resource_type then resource_name).
  const resGroups = new Map<string, ResourceOpt[]>();
  for (const r of eligibleResources) {
    const k = r.resource_type ?? '__untyped__';
    if (!resGroups.has(k)) resGroups.set(k, []);
    resGroups.get(k)!.push(r);
  }
  const resLabel = (r: ResourceOpt) => `${r.name}${busyRes.has(r.id) ? ' · in use' : ''}`;
  // The Select primitive uses `items` for its trigger's value→label lookup —
  // every selectable option must appear in this flat list, even though the
  // SelectContent below groups them visually. Order matches the groups so
  // there are no orphans.
  const resOptions = [
    { value: NONE, label: 'None', disabled: false },
    ...eligibleResources.map((r) => ({ value: r.id, label: resLabel(r), disabled: busyRes.has(r.id) })),
  ];
  const discRate = (d: DiscountOpt): string | null =>
    d.discount_percent > 0
      ? `${d.discount_percent}%`
      : d.discount_amount_cents > 0
        ? `${(d.discount_amount_cents / 100).toLocaleString()}`
        : null;
  const discOptions = discountClasses.map((d) => {
    const rate = discRate(d);
    return { value: d.id, label: rate ? `${d.code} — ${rate} — ${d.description}` : `${d.code} — ${d.description}` };
  });

  const itemsByCustomer = (cid: string) => items.filter((i) => i.order_customer_id === cid);
  // A guest can be removed only while none of their services have started and no
  // payment is attributed to them — mirrors the server guard.
  const customerRemovable = (c: OrderCustomer) =>
    !items.some((i) => i.order_customer_id === c.id && !['scheduled', 'cancelled'].includes(i.status))
    && c.paid_cents === 0;
  const multiCustomer = customers.length > 1;
  // Guests who still owe on their own line (Pay separately shows one card each).
  const splitCustomers = customers
    .slice()
    .sort((a, b) => a.seq_no - b.seq_no)
    .filter((c) => c.subtotal_cents - c.paid_cents > 0);
  // Therapists to tip for a customer (null = whole order): only services that were
  // actually completed (done) — switched / cancelled / interrupted / not-yet-done
  // lines aren't tippable.
  const tipTargetsFor = (customerId: string | null): TipTarget[] =>
    items
      .filter((it) =>
        (customerId == null || it.order_customer_id === customerId)
        && it.therapist_id
        && ['service_completed', 'feedback_done'].includes(it.status))
      .map((it) => ({
        orderItemId: it.id,
        therapistId: it.therapist_id as string,
        therapistName: it.therapist_name ?? 'Therapist',
        serviceName: it.service_name,
      }));

  return (
    <TooltipProvider>
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => v && setTab(v)} className="w-full flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="guests"><Users /> Guest List</TabsTrigger>
          <TabsTrigger value="folio"><Receipt /> Folio</TabsTrigger>
          <TabsTrigger value="feedback"><Star /> Feedback</TabsTrigger>
          <TabsTrigger value="history"><History /> Change History</TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="flex flex-col gap-4">
      {/* section header: pax count + add customer */}
      {/* Same column grid as the service rows so "Start all" lands above the Action column. */}
      <div className="grid grid-cols-[11rem_10rem_11rem_18rem_10rem_1fr] items-end gap-x-3 px-4">
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
          <Button
            onClick={doStartAll}
            disabled={pending}
            className="bg-blue-600 font-bold text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-500/40 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            <Play className="size-4 fill-current" /> Start all
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
              {editCust === c.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{c.seq_no}</span>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Name"
                    className="h-8 w-44"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') doRenameCustomer(); if (e.key === 'Escape') setEditCust(null); }}
                  />
                  <Input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className="h-8 w-36"
                    onKeyDown={(e) => { if (e.key === 'Enter') doRenameCustomer(); if (e.key === 'Escape') setEditCust(null); }}
                  />
                  <Button size="icon-sm" variant="ghost" onClick={doRenameCustomer} disabled={pending}>
                    <Check className="size-4 text-primary" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditCust(null)} disabled={pending}>
                    <X className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{c.seq_no}</span>
                  {c.customer_name}
                  {c.customer_phone && <span className="font-medium text-muted-foreground">{c.customer_phone}</span>}
                  {order.editable && (
                    <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => startEditCustomer(c)} disabled={pending}>
                      <Pencil className="size-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </CardTitle>
              )}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold tabular">{peso(c.subtotal_cents)}</span>
                {order.editable && customerRemovable(c) && (
                  <Button size="icon-sm" variant="ghost" onClick={() => doRemoveCustomer(c.id)} disabled={pending} title="Remove guest">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {itemsByCustomer(c.id).length > 0 && (
                <div className="grid grid-cols-[11rem_10rem_11rem_18rem_10rem_1fr] items-center gap-x-3 border-b border-border pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
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
                  // A finished line keeps its bed for the cleanup buffer, unless
                  // released early. While cleaning, surface "free ~HH:MM" + Ready now.
                  const cleaningUntil =
                    ['service_completed', 'feedback_done', 'interrupted'].includes(it.status)
                    && it.actual_end && it.resource_id && it.cleanup_minutes > 0 && !it.bed_released_at
                      ? new Date(new Date(it.actual_end).getTime() + it.cleanup_minutes * 60000)
                      : null;
                  const isCleaning = cleaningUntil != null && cleaningUntil.getTime() > Date.now();
                  // This guest already has a live service → can't start another yet.
                  const guestHasLiveService = items.some((x) => x.id !== it.id && x.order_customer_id === it.order_customer_id && x.status === 'in_service');
                  const detailParts = [
                    it.duration_minutes ? `${it.duration_minutes} min` : null,
                    it.station_name,
                    timeWindow(it.actual_start, it.actual_end, it.duration_minutes, it.prep_minutes),
                    isCleaning ? `cleaning · free ~${hm(cleaningUntil!.toISOString())}` : null,
                  ].filter(Boolean) as string[];
                  const statusTag =
                    it.status === 'in_service' ? { t: 'In service', c: 'text-blue-600 dark:text-blue-400' }
                    : isCleaning ? { t: 'Cleaning', c: 'text-amber-600 dark:text-amber-400' }
                    : (it.status === 'service_completed' || it.status === 'feedback_done') ? { t: 'Done', c: 'text-primary' }
                    : it.status === 'interrupted' ? (it.switched ? { t: 'Switched', c: 'text-amber-600 dark:text-amber-400' } : { t: 'Interrupted', c: 'text-destructive' })
                    : it.status === 'cancelled' ? { t: 'Cancelled', c: 'text-muted-foreground' }
                    : null;
                  return (
                  <li key={it.id} className={`grid grid-cols-[11rem_10rem_11rem_18rem_10rem_1fr] items-center gap-x-3 py-2 text-sm ${it.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    <span className="font-semibold truncate">{it.service_name}</span>
                    <span className="font-medium text-muted-foreground truncate">
                      {it.therapist_name ?? 'Unassigned'}
                      {it.therapist_home_branch_code && ` · ${it.therapist_home_branch_code}`}
                    </span>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wide truncate">
                        {statusTag && <span className={statusTag.c}>{statusTag.t}</span>}
                      </span>
                      {isCleaning && (
                        <ActionBtn
                          tip="Free the bed now, before the cleanup buffer ends."
                          variant="outline"
                          className="border-teal-500/60 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400 dark:hover:bg-teal-500/10"
                          onClick={() => doReleaseBed(it.id)}
                          disabled={pending}
                        >
                          Ready now
                        </ActionBtn>
                      )}
                    </div>
                    <span className="text-xs font-medium text-muted-foreground tabular truncate">
                      {detailParts.join(' · ')}
                    </span>
                    <div className="flex items-center gap-2">
                      {canRunService && it.status === 'scheduled' && (
                        <>
                          <ActionBtn
                            tip={guestHasLiveService ? 'Finish this guest’s current service before starting the next.' : 'Begin this service now — stamps the start time.'}
                            className="bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 dark:bg-green-600 dark:hover:bg-green-700"
                            onClick={() => doStartItem(it)}
                            disabled={pending || guestHasLiveService}
                          >
                            Start
                          </ActionBtn>
                          <ActionBtn
                            tip="Cancel this service — drops it from the bill but keeps it in the record."
                            variant="outline"
                            className="border-muted-foreground/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => setCancelItem(it)}
                            disabled={pending}
                          >
                            Cancel
                          </ActionBtn>
                        </>
                      )}
                      {canRunService && it.status === 'in_service' && (
                        <>
                          <ActionBtn
                            tip="Mark this service finished — stamps the end time."
                            className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
                            onClick={() => doFinishItem(it)}
                            disabled={pending}
                          >
                            Finish
                          </ActionBtn>
                          <ActionBtn
                            tip="Stop this service with no charge and pick a different one."
                            variant="outline"
                            className="border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10"
                            onClick={() => doSwitchItem(it)}
                            disabled={pending}
                          >
                            Switch
                          </ActionBtn>
                          <ActionBtn
                            tip="Stop mid-service and decide the charge (none / partial / full / reschedule)."
                            variant="outline"
                            className="border-destructive/50 text-destructive hover:bg-destructive/10"
                            onClick={() => setInterruptItem(it)}
                            disabled={pending}
                          >
                            Interrupt
                          </ActionBtn>
                        </>
                      )}
                      {/* "Ready now" lives next to the Cleaning status, not here. */}
                      {['service_completed', 'feedback_done'].includes(it.status) && it.feedback_score == null && (
                        <ActionBtn
                          tip="Record the guest's feedback — a score is required."
                          variant="outline"
                          className="border-violet-500/60 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:text-violet-400 dark:hover:bg-violet-500/10"
                          onClick={() => setFeedbackItem(it)}
                          disabled={pending}
                        >
                          <Star className="size-3.5" /> Feedback
                        </ActionBtn>
                      )}
                      {['interrupted', 'cancelled'].includes(it.status) && !it.switched && !['paid', 'closed', 'void'].includes(order.status) && (
                        <ActionBtn
                          tip="Re-add this service as a fresh line to do again."
                          variant="outline"
                          className="border-indigo-500/60 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
                          onClick={() => doRedoItem(it.id)}
                          disabled={pending}
                        >
                          Redo
                        </ActionBtn>
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
                      {order.editable && it.status === 'scheduled' && (
                        <Button size="icon-sm" variant="ghost" onClick={() => startEditItem(it)} disabled={pending} title="Edit service">
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                      )}
                      {/* Hard delete only on a draft order; once open, Skip is the remove path. */}
                      {order.status === 'draft' && it.status === 'scheduled' && (
                        <Button size="icon-sm" variant="ghost" onClick={() => doRemoveItem(it.id)} disabled={pending} title="Remove service">
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
                    <p className="col-span-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {editingItemId ? 'Edit service' : 'Add service'}
                    </p>
                    <div className="max-w-[15rem]">
                      <Label className="text-xs font-semibold">Service</Label>
                      <Select
                        items={groupOptions}
                        value={groupSel}
                        onValueChange={(v) => {
                          if (!v) return;
                          setGroupSel(v);
                          setSvcId('');
                          setTherapistId(NONE);
                          // Switching groups can change the required station
                          // type (Massage → Nail). Drop a station that no
                          // longer fits so the user picks one that does.
                          if (resourceId !== NONE) {
                            const newGroupType = serviceItems.find((s) => s.group === v)?.required_resource_type ?? null;
                            const cur = resources.find((r) => r.id === resourceId);
                            if (newGroupType && cur && cur.resource_type !== newGroupType) setResourceId(NONE);
                          }
                        }}
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
                        onValueChange={(v) => {
                          if (!v) return;
                          setSvcId(v);
                          // Drop a now-mismatched station so the user can't carry
                          // (say) a massage Bed over to a freshly picked Gel Polish
                          // — the picker would filter it out anyway, so silently
                          // clearing is less confusing than showing a stale value.
                          if (resourceId !== NONE) {
                            const need = serviceItems.find((s) => s.id === v)?.required_resource_type ?? null;
                            const cur = resources.find((r) => r.id === resourceId);
                            if (need && cur && cur.resource_type !== need) setResourceId(NONE);
                          }
                        }}
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
                        <Label className="text-xs font-semibold">{selectedDiscountCode} amount *</Label>
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
                              <SelectItem value={NONE}>None</SelectItem>
                              {eligibleResources.length === 0 ? (
                                <SelectItem value="__nomatch__" disabled>
                                  {neededType
                                    ? `No ${RESOURCE_TYPE_LABEL[neededType] ?? neededType} at this branch`
                                    : 'No stations'}
                                </SelectItem>
                              ) : (
                                [...resGroups.entries()].map(([type, list]) => (
                                  <SelectGroup key={type}>
                                    <SelectLabel>{RESOURCE_TYPE_LABEL[type] ?? type}</SelectLabel>
                                    {list.map((r) => (
                                      <SelectItem key={r.id} value={r.id} disabled={busyRes.has(r.id)}>
                                        {resLabel(r)}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="max-w-[15rem]">
                          <Label className="text-xs font-semibold">Therapist gender</Label>
                          <Select
                            items={GENDER_OPTS}
                            value={genderPref}
                            onValueChange={(v) => {
                              const g = v ?? ANY_GENDER;
                              setGenderPref(g);
                              // Drop a now-mismatched selection so you can't keep a wrong-gender therapist.
                              if (g !== ANY_GENDER && therapistId !== NONE && genderOf.get(therapistId) !== g) setTherapistId(NONE);
                            }}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {GENDER_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-3 flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={closeItemForm} disabled={pending}>Cancel</Button>
                      {editingItemId ? (
                        <Button size="sm" onClick={doSaveItem} disabled={pending || !svcId}>Save changes</Button>
                      ) : (
                        <Button size="sm" onClick={() => doAddItem(c.id)} disabled={pending || !svcId}>Add</Button>
                      )}
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
          <div className="grid grid-cols-4 gap-3">
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total charges</p><p className="text-xl font-extrabold tabular mt-1">{peso(order.total_cents)}</p></CardContent></Card>
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Paid</p><p className="text-xl font-extrabold tabular mt-1">{peso(order.paid_cents)}</p></CardContent></Card>
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Outstanding</p><p className="text-xl font-extrabold tabular mt-1">{peso(due)}</p></CardContent></Card>
            <Card><CardContent className="py-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Tips (PAYMAYA)</p><p className="text-xl font-extrabold tabular mt-1 text-primary">{peso(totalTips)}</p></CardContent></Card>
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
              (multiCustomer && payMode === 'split' && splitCustomers.length > 0 ? (
                splitCustomers.map((c) => (
                    <CustomerPaymentCard
                      key={`${c.id}-${c.subtotal_cents - c.paid_cents}`}
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
                  key={`whole-${due}`}
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
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Recorded payments
                  {order.status === 'paid' && (
                    <span className="ml-2 font-medium normal-case text-muted-foreground/80">— fully paid; use Collect / Refund above to adjust</span>
                  )}
                </p>
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-semibold">{p.method_name}</span>
                      {p.customer_label && <span className="ml-2 font-medium text-muted-foreground">{p.customer_label}</span>}
                      {p.payment_ref && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.payment_ref}</span>}
                      {p.tip_cents > 0 && <span className="ml-2 text-xs font-semibold text-primary">+ tip {peso(p.tip_cents)}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.amount_cents < 0 && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">Refund</span>}
                      <span className="font-bold tabular">{peso(p.amount_cents)}</span>
                      {order.status !== 'paid' && (
                        <Button size="icon-sm" variant="ghost" onClick={() => setVoidPaymentId(p.id)} disabled={pending} title="Remove payment">
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
                      ? <span className="text-xs font-medium text-muted-foreground">Cancelled</span>
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
          {/* Two views stacked: the curated status-only narrative (concise —
              draft → open / first service started / …) at the top, then the
              full row-level audit trail below with field-level diffs from
              audit_log. The narrative is built from order_status_log +
              order_edit_log so it carries the human reason text the trigger-
              based audit can't see; the audit trail is the complete record
              of every column change on every row tied to this order. */}
          <div className="flex flex-col gap-4">
            {history.length > 0 && (
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
            <Card>
              <CardContent>
                <AuditTrail entries={auditTrail} />
              </CardContent>
            </Card>
          </div>
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
          pinManagers={pinManagers}
          viewerIsManager={viewerIsManager}
        />
      )}

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

      <AlertDialog open={!!cancelItem} onOpenChange={(o) => { if (!o) setCancelItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this service?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{cancelItem?.service_name}</strong> will be dropped from the bill and not performed.
              It stays in the record and can be redone later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (cancelItem) doSkipItem(cancelItem.id); setCancelItem(null); }}>
              Cancel service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!voidPaymentId} onOpenChange={(o) => { if (!o) setVoidPaymentId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              The amount returns to the order's outstanding balance. A stored-value redemption is refunded back onto the card; tips on this payment are removed. Already-settled tips block the removal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (voidPaymentId) doVoidPayment(voidPaymentId); setVoidPaymentId(null); }}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remove payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
}
