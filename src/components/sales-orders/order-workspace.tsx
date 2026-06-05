'use client';

import { type ComponentProps, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, UserPlus, CreditCard, Wand2, Users, Receipt, Star, History, Play, Check } from 'lucide-react';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addOrderCustomer,
  removeOrderCustomer,
  updateOrderCustomer,
  addOrderItem,
  updateOrderItem,
  markNoShow,
  startOrderItem,
  startAllServices,
  finishOrderItem,
  skipOrderItem,
  redoOrderItem,
  switchService,
  releaseBed,
} from '@/app/(dashboard)/sales-orders/actions';
import { ServiceLineEditor, type LineDraft } from '@/components/sales-orders/service-line-editor';
import { CustomerPaymentCard, type TipTarget } from '@/components/sales-orders/customer-payment-card';
import { FeedbackDialog } from '@/components/sales-orders/feedback-dialog';
import { AuditTrail } from '@/components/sales-orders/audit-trail';
import { InterruptDialog } from '@/components/sales-orders/interrupt-dialog';
import { ANY_GENDER, canPerformGroup, matchesGender } from '@/lib/therapist-availability';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

// Shared column template for a guest's service table so the header row, the
// inline-editable rows, and the read-only rows all line up. The table scrolls
// horizontally inside its card. Add a column here (+ its header + cell) when
// surfacing more per-line fields.
const SERVICE_GRID = 'grid grid-cols-[8.5rem_5.5rem_7rem_14rem_12rem_5.5rem_8.5rem_6rem_5.5rem_5.5rem_7rem_auto] items-center gap-x-2';

interface OrderItem {
  id: string;
  order_customer_id: string;
  service_item_id: string | null;
  discount_class_id: string | null;
  service_name: string;
  therapist_name: string | null;
  therapist_home_branch_code: string | null;
  therapist_id: string | null;
  resource_id: string | null;
  station_name: string | null;
  station_branch_code: string | null;
  scheduled_start: string | null;
  external_room_no: string | null;
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
  // Preferred therapist gender for this guest (applies to all their service
  // lines). null / ANY_GENDER = no preference. M / F = that gender only.
  gender: string | null;
  seq_no: number;
  subtotal_cents: number;
  paid_cents: number;
}
interface Opt { id: string; code: string; name: string; gender?: string | null; visiting?: boolean }
interface BorrowOpt { id: string; code: string; name: string; gender?: string | null; homeBranchCode: string | null }
interface ResourceOpt { id: string; name: string; resource_type: string | null; branchCode: string | null }
interface DiscountOpt { id: string; code: string; description: string; discount_percent: number; discount_amount_cents: number }
interface ServiceVariant { id: string; name: string; group: string; duration_minutes: number; price_cents: number | null; allowed_resource_types: string[] }
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
    service_date: string;
    service_location_type: string | null;
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

function hm(ts: string | null): string {
  return ts ? new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }) : '';
}
// ISO → 24h HH:mm in Manila time (for the <input type="time"> + the Start cell).
function toHHmm(ts: string | null): string {
  return ts ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)) : '';
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

// Always-open name + phone fields for a guest — no edit-pencil toggle. Local
// state is the source of truth while typing; edits persist on blur / Enter and
// only when the name is non-empty and something actually changed. Keyed by
// customer id at the call site so each guest keeps its own buffer.
function GuestIdentity({ name: initialName, phone: initialPhone, onSave }: {
  name: string;
  phone: string | null;
  onSave: (name: string, phone: string | null) => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? '');
  const commit = () => {
    const nm = name.trim();
    const ph = phone.trim();
    if (nm === (initialName ?? '').trim() && ph === (initialPhone ?? '').trim()) return;
    if (!nm) { toast.error('Customer name required'); return; }
    onSave(nm, ph || null);
  };
  return (
    <>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        placeholder="Name"
        className="h-8 w-40"
      />
      <Input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        placeholder="Phone (optional)"
        className="h-8 w-36"
      />
    </>
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

  // add item (per customer) — two-step: group → duration variant. This panel only
  // ADDS new lines now; existing not-yet-started lines edit inline (per row).
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
  const [addStart, setAddStart] = useState('');
  const [addRoomNo, setAddRoomNo] = useState('');
  const selectedDiscountCode = discountClasses.find((d) => d.id === discountId)?.code ?? '';
  const needsDiscountAmount = ['DIS-91', 'DIS-99'].includes(selectedDiscountCode);

  // Inline per-line editing: every not-yet-started line is open at once (no
  // pencil). Each line keeps a draft; the guest's header Save commits the dirty
  // ones (the server recomputes price). A draft falls back to the line's own
  // values, so after a save (+ refresh) the cleared draft shows the fresh data.
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const draftFromItem = (it: OrderItem): LineDraft => ({
    groupSel: serviceItems.find((s) => s.id === it.service_item_id)?.group ?? '',
    svcId: it.service_item_id ?? '',
    start: toHHmm(it.scheduled_start),
    therapistId: it.therapist_id ?? NONE,
    resourceId: it.resource_id ?? NONE,
    roomNo: it.external_room_no ?? '',
    discountId: it.discount_class_id ?? defaultDiscountId,
    discountOverride: it.discount_amount_cents > 0 ? String(it.discount_amount_cents / 100) : '',
  });
  const effectiveDraft = (it: OrderItem): LineDraft => lineDrafts[it.id] ?? draftFromItem(it);
  const setDraft = (it: OrderItem, patch: Partial<LineDraft>) =>
    setLineDrafts((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? draftFromItem(it)), ...patch } }));
  const lineIsDirty = (it: OrderItem): boolean => {
    const d = lineDrafts[it.id];
    if (!d) return false;
    const b = draftFromItem(it);
    return d.svcId !== b.svcId || d.therapistId !== b.therapistId || d.resourceId !== b.resourceId
      || d.discountId !== b.discountId || d.discountOverride !== b.discountOverride || d.start !== b.start || d.roomNo !== b.roomNo;
  };
  const guestGenderOf = (c: OrderCustomer): string => (c.gender === 'M' || c.gender === 'F' ? c.gender : ANY_GENDER);
  const isLineEditable = (it: OrderItem): boolean => order.editable && ['draft'].includes(it.status);

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
  const router = useRouter();

  const due = Math.max(0, order.total_cents - order.paid_cents);
  const totalTips = payments.reduce((s, p) => s + p.tip_cents, 0);
  const canRunService = ['draft', 'in_service'].includes(order.status);
  // Whole order dispatched to a hotel → services use a room no, not an in-house station.
  const dispatch = order.service_location_type === 'external_hotel';

  // Therapist-gender preference now lives on the guest, not the service line.
  // The service editor (only ever open for one guest at a time) filters its
  // therapist picker / auto-assign by the active guest's preference.
  const activeGuestGender = (() => {
    const g = customers.find((c) => c.id === activeCustomer)?.gender;
    return g === 'M' || g === 'F' ? g : ANY_GENDER;
  })();

  function doAddCustomer() {
    startTransition(async () => {
      const r = await addOrderCustomer({
        order_id: order.id,
        customer_name: custName.trim() || null,
        customer_phone: custPhone.trim() || null,
      });
      if (r.ok) { setCustName(''); setCustPhone(''); toast.success('Guest added'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Set a guest's preferred therapist gender (persists to order_customers.gender).
  function doSetGuestGender(c: OrderCustomer, g: string) {
    startTransition(async () => {
      const r = await updateOrderCustomer({
        id: c.id,
        order_id: order.id,
        customer_name: c.customer_name,
        customer_phone: c.customer_phone,
        gender: g === ANY_GENDER ? null : g,
      });
      // The therapist picker re-filters to the new preference and the server
      // re-validates on assign/start, so a stale pick can't actually be saved.
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  }

  // Streamlined walk-in entry: an editable order with no guests gets a "Guest 1"
  // created automatically on open, so the Add Service picker is reachable
  // immediately without first naming a customer. Fires once per mount.
  const autoGuestTried = useRef(false);
  useEffect(() => {
    if (!order.editable || customers.length > 0 || autoGuestTried.current) return;
    autoGuestTried.current = true;
    (async () => {
      const r = await addOrderCustomer({ order_id: order.id, customer_name: null, customer_phone: null });
      if (r.ok) router.refresh();
    })();
  }, [order.editable, customers.length, order.id, router]);

  function closeItemForm() {
    setActiveCustomer(null);
    setAddStart(''); setAddRoomNo('');
    setSvcId(''); setGroupSel(''); setDiscountId(defaultDiscountId); setDiscountOverride('');
    setTherapistId(NONE); setResourceId(NONE);
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
        scheduled_start: addStart ? `${order.service_date}T${addStart}:00+08:00` : null,
        external_room_no: dispatch ? (addRoomNo.trim() || null) : null,
      });
      if (r.ok) { closeItemForm(); toast.success('Service added'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Commit every dirty (edited) not-yet-started line for this guest in one go —
  // the guest header's Save. The server recomputes list/final price from the
  // chosen service + discount, so editing never touches the amount directly.
  function doSaveGuest(c: OrderCustomer) {
    const dirty = itemsByCustomer(c.id).filter((it) => isLineEditable(it) && lineIsDirty(it));
    if (dirty.length === 0) { toast.info('No changes to save'); return; }
    for (const it of dirty) {
      if (!effectiveDraft(it).svcId) { toast.error('Pick a service for every line'); return; }
    }
    startTransition(async () => {
      for (const it of dirty) {
        const d = effectiveDraft(it);
        const code = discountClasses.find((x) => x.id === d.discountId)?.code ?? '';
        const r = await updateOrderItem({
          id: it.id,
          order_id: order.id,
          service_item_id: d.svcId,
          therapist_id: d.therapistId === NONE ? null : d.therapistId,
          resource_id: d.resourceId === NONE ? null : d.resourceId,
          discount_class_id: sourceDiscountLocked ? defaultDiscountId : d.discountId,
          discount_override: ['DIS-91', 'DIS-99'].includes(code) ? Number(d.discountOverride || 0) : null,
          scheduled_start: d.start ? `${order.service_date}T${d.start}:00+08:00` : null,
          external_room_no: dispatch ? (d.roomNo.trim() || null) : null,
        });
        if (!r.ok) { toast.error(r.error); return; }
      }
      setLineDrafts((prev) => { const n = { ...prev }; dirty.forEach((it) => delete n[it.id]); return n; });
      toast.success(dirty.length === 1 ? 'Service saved' : `${dirty.length} services saved`);
      router.refresh();
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
      .filter((i) => ['draft', 'in_service'].includes(i.status))
      .forEach((i) => {
        if (i.therapist_id) takenTherapists.add(i.therapist_id);
        if (i.resource_id) takenStations.add(i.resource_id);
      });

    const neededGroup = serviceItems.find((s) => s.id === svcId)?.group ?? groupSel;
    const matchTherapist = (e: { id: string; gender?: string | null }) =>
      !takenTherapists.has(e.id)
      && canPerformGroup(capabilityByEmployee[e.id] ?? [], neededGroup)
      && matchesGender(e.gender, activeGuestGender);
    // Priority: this branch's own (home) therapists → others on a cross-branch
    // shift here → borrow from the sharing group. A home therapist is always
    // preferred over someone just visiting or borrowed.
    const ownHomeFree = employees.find((e) => !e.visiting && matchTherapist(e));
    const ownVisitingFree = ownHomeFree ? undefined : employees.find((e) => e.visiting && matchTherapist(e));
    const borrowedFree = ownHomeFree || ownVisitingFree ? undefined : borrowableEmployees.find(matchTherapist);
    const freeTherapist = ownHomeFree ?? ownVisitingFree ?? borrowedFree;
    const note = ownVisitingFree ? ' (visiting)' : borrowedFree?.homeBranchCode ? ` (borrowed · ${borrowedFree.homeBranchCode})` : '';
    const neededTypes = serviceItems.find((s) => s.id === svcId)?.allowed_resource_types ?? [];
    const neededLabel = neededTypes.length ? neededTypes.join(' or ') : '';
    const freeStation = resources.find(
      (r) => !takenStations.has(r.id) && (neededTypes.length === 0 || (r.resource_type != null && neededTypes.includes(r.resource_type))),
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
      toast.warning(`${changed[0]} set — ${missingTherapist ? 'no free therapist (own or borrowable)' : `no free station${neededLabel ? ` (${neededLabel})` : ''}`}`);
    } else if (missingTherapist && missingStation) {
      toast.error('No free therapist (own or borrowable) or station');
    } else if (missingTherapist) {
      toast.error('No free therapist (own or borrowable)');
    } else if (missingStation) {
      toast.error(`No free station${neededLabel ? ` (${neededLabel})` : ''}`);
    }
  }

  function doUpdateGuest(id: string, name: string, phone: string | null) {
    startTransition(async () => {
      const r = await updateOrderCustomer({ id, order_id: order.id, customer_name: name, customer_phone: phone });
      if (r.ok) { toast.success('Guest updated'); router.refresh(); }
      else toast.error(r.error);
    });
  }


  function doNoShow(id: string) {
    startTransition(async () => {
      const r = await markNoShow(id, order.id);
      if (r.ok) { toast.success('Marked no-show'); router.refresh(); } else toast.error(r.error);
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

  const itemsByCustomer = (cid: string) => items.filter((i) => i.order_customer_id === cid);

  // Auto-open the Add Service picker only for the first guest who has no services
  // yet, so "pick a service" is visible the moment a fresh order opens — no extra
  // click. A guest who already has a service stays collapsed (their "Add service"
  // button is one click away). Fires once per mount (a manual Cancel won't make
  // it pop back open).
  const autoOpenedPicker = useRef(false);
  useEffect(() => {
    if (autoOpenedPicker.current || !order.editable || customers.length === 0) return;
    const sorted = [...customers].sort((a, b) => a.seq_no - b.seq_no);
    const target = sorted.find((c) => itemsByCustomer(c.id).length === 0);
    if (target) { autoOpenedPicker.current = true; setActiveCustomer(target.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, items, order.editable]);

  // A guest can be removed only before any service line exists for them and while
  // no payment is attributed — once they have services, void/cancel the lines
  // instead of deleting the guest.
  const customerRemovable = (c: OrderCustomer) =>
    itemsByCustomer(c.id).length === 0 && c.paid_cents === 0;
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
        && it.status === 'service_completed')
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
          <TabsTrigger value="history"><History /> Change History</TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="flex flex-col gap-4">
      {/* section header: pax count + add customer */}
      {/* Same column grid as the service rows so "Start all" lands above the Action column. */}
      <div className="grid grid-cols-[11rem_10rem_11rem_18rem_10rem_1fr] items-end gap-x-3 px-4">
        <div className="col-span-4 flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold">Guests</h3>
          </div>
          {order.editable && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Customer name</Label>
                <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Optional" className="w-44" onKeyDown={(e) => { if (e.key === 'Enter') doAddCustomer(); }} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Phone</Label>
                <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="Optional" className="w-36" onKeyDown={(e) => { if (e.key === 'Enter') doAddCustomer(); }} />
              </div>
              <Button size="sm" onClick={doAddCustomer} disabled={pending}>
                <UserPlus className="size-4" /> Add Customer
              </Button>
            </div>
          )}
        </div>
        {canRunService && items.some((i) => i.status === 'draft') ? (
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{c.seq_no}</span>
                {order.editable ? (
                  <>
                    {/* Name + phone are always open for editing — no pencil toggle. */}
                    <GuestIdentity
                      key={c.id}
                      name={c.customer_name}
                      phone={c.customer_phone}
                      onSave={(name, phone) => doUpdateGuest(c.id, name, phone)}
                    />
                    {/* Preferred therapist gender is a guest attribute (applies to
                        all of this guest's services), not a per-service setting. */}
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Therapist gender</Label>
                      <Select
                        items={GENDER_OPTS}
                        value={c.gender === 'M' || c.gender === 'F' ? c.gender : ANY_GENDER}
                        onValueChange={(v) => doSetGuestGender(c, v ?? ANY_GENDER)}
                      >
                        <SelectTrigger className="h-8 w-32" aria-label="Preferred therapist gender"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GENDER_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    {c.customer_name}
                    {c.customer_phone && <span className="font-medium text-muted-foreground">{c.customer_phone}</span>}
                    {(c.gender === 'M' || c.gender === 'F') && (
                      <span className="text-xs font-semibold text-muted-foreground">{c.gender === 'F' ? 'Female only' : 'Male only'}</span>
                    )}
                  </CardTitle>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {order.editable && itemsByCustomer(c.id).some(isLineEditable) && (
                  <Button
                    size="sm"
                    onClick={() => doSaveGuest(c)}
                    disabled={pending || !itemsByCustomer(c.id).some(lineIsDirty)}
                    title="Save the edited service lines (recomputes price)"
                  >
                    <Check className="size-3.5" /> Save
                  </Button>
                )}
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
                <div className="overflow-x-auto">
                  <div className="min-w-max">
                    <div className={`${SERVICE_GRID} border-b border-border pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground`}>
                      <span>Service</span>
                      <span>Duration</span>
                      <span>Start</span>
                      <span>Therapist</span>
                      <span>{dispatch ? 'Room' : 'Station'}</span>
                      <span className="text-right">Price</span>
                      <span>Discount</span>
                      <span>Disc.</span>
                      <span className="text-right">Amount</span>
                      <span>Status</span>
                      <span>Feedback</span>
                      <span />
                    </div>
                    <ul className="flex flex-col divide-y divide-border">
                      {itemsByCustomer(c.id).map((it) => {
                        const cleaningUntil =
                          ['service_completed', 'interrupted'].includes(it.status)
                          && it.actual_end && it.resource_id && it.cleanup_minutes > 0 && !it.bed_released_at
                            ? new Date(new Date(it.actual_end).getTime() + it.cleanup_minutes * 60000)
                            : null;
                        const isCleaning = cleaningUntil != null && cleaningUntil.getTime() > Date.now();
                        const guestHasLiveService = items.some((x) => x.id !== it.id && x.order_customer_id === it.order_customer_id && x.status === 'in_service');

                        // Not-yet-started lines edit inline — bare selects in the
                        // same columns as the read-only rows so everything aligns.
                        if (isLineEditable(it)) {
                          const d = effectiveDraft(it);
                          return (
                            <li key={it.id} className={`${SERVICE_GRID} py-1.5`}>
                              <ServiceLineEditor
                                draft={d}
                                onChange={(patch) => setDraft(it, patch)}
                                serviceItems={serviceItems}
                                employees={employees}
                                borrowableEmployees={borrowableEmployees}
                                resources={resources}
                                discountClasses={discountClasses}
                                capabilityByEmployee={capabilityByEmployee}
                                busyTherapistIds={busyTherapistIds}
                                busyResourceIds={busyResourceIds}
                                guestGender={guestGenderOf(c)}
                                sourceDiscountLocked={sourceDiscountLocked}
                                defaultDiscountId={defaultDiscountId}
                                dispatch={dispatch}
                                disabled={pending}
                              />
                              <span className="text-right font-bold tabular text-sm">{peso(it.final_amount_cents)}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">—</span>
                              <span className="text-xs font-medium text-muted-foreground">—</span>
                              <div className="flex flex-wrap items-center gap-1 justify-end">
                                {canRunService && it.status === 'draft' && (
                                  <ActionBtn tip={guestHasLiveService ? 'Finish this guest’s current service first.' : 'Begin this service now — stamps the start time.'} className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" onClick={() => doStartItem(it)} disabled={pending || guestHasLiveService}>Start</ActionBtn>
                                )}
                                {canRunService && it.status === 'draft' && (
                                  <ActionBtn tip="Cancel this service — drops it from the bill but keeps it in the record." variant="outline" className="border-muted-foreground/40 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setCancelItem(it)} disabled={pending}>Cancel</ActionBtn>
                                )}
                                {!['paid', 'closed', 'void'].includes(order.status) && (
                                  <ActionBtn tip="Guest didn't show — mark no-show (zero charge, leaves the schedule)." variant="outline" className="border-muted-foreground/40 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => doNoShow(it.id)} disabled={pending}>No-show</ActionBtn>
                                )}
                              </div>
                            </li>
                          );
                        }

                        const statusTag =
                          it.status === 'in_service' ? { t: 'In service', c: 'text-blue-600 dark:text-blue-400' }
                          : isCleaning ? { t: 'Cleaning', c: 'text-amber-600 dark:text-amber-400' }
                          : (it.status === 'service_completed') ? { t: 'Done', c: 'text-primary' }
                          : it.status === 'interrupted' ? (it.switched ? { t: 'Switched', c: 'text-amber-600 dark:text-amber-400' } : { t: 'Interrupted', c: 'text-destructive' })
                          : it.status === 'cancelled' ? { t: 'Cancelled', c: 'text-muted-foreground' }
                          : it.status === 'no_show' ? { t: 'No-show', c: 'text-muted-foreground' }
                          : null;
                        const tw = timeWindow(it.actual_start, it.actual_end, it.duration_minutes, it.prep_minutes);
                        const dc = discountClasses.find((dd) => dd.id === it.discount_class_id);
                        const discCode = dc?.description ?? '—';
                        // Discount value: percent classes show the rate, fixed/manual show the peso amount applied.
                        const discValue = it.discount_amount_cents > 0
                          ? (dc && dc.discount_percent > 0 ? `-${dc.discount_percent}%` : `-${peso(it.discount_amount_cents)}`)
                          : '—';
                        return (
                          <li key={it.id} className={`${SERVICE_GRID} py-2 text-sm ${it.status === 'cancelled' ? 'opacity-60' : ''}`}>
                            <span className="font-semibold truncate">{serviceItems.find((s) => s.id === it.service_item_id)?.group ?? it.service_name}</span>
                            <span className="text-xs font-medium text-muted-foreground truncate">
                              {it.duration_minutes ? `${it.duration_minutes} min` : '—'}
                              {tw && <span className="block tabular opacity-80">{tw}</span>}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground tabular truncate">{toHHmm(it.actual_start ?? it.scheduled_start) || '—'}</span>
                            <span className="font-medium text-muted-foreground truncate">
                              {it.therapist_name ?? 'Unassigned'}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground truncate">
                              {dispatch ? (it.external_room_no || '—') : <>{it.station_branch_code ? `${it.station_branch_code} · ` : ''}{it.station_name ?? '—'}</>}
                              {isCleaning && (
                                <span className="mt-0.5 block">
                                  <ActionBtn tip="Free the bed now, before the cleanup buffer ends." variant="outline" className="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => doReleaseBed(it.id)} disabled={pending}>Ready now</ActionBtn>
                                </span>
                              )}
                            </span>
                            <span className="text-right tabular text-sm font-medium text-muted-foreground">{peso(it.list_price_cents)}</span>
                            <span className="text-xs font-medium text-muted-foreground truncate">{discCode}</span>
                            <span className="text-xs font-medium text-muted-foreground tabular truncate">{discValue}</span>
                            <span className="text-right tabular text-sm">
                              {['cancelled', 'no_show'].includes(it.status) ? (
                                <span className="font-medium line-through text-muted-foreground">{peso(it.final_amount_cents)}</span>
                              ) : (
                                <span className="font-bold">{peso(it.final_amount_cents)}</span>
                              )}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wide truncate">
                              {statusTag && <span className={statusTag.c}>{statusTag.t}</span>}
                            </span>
                            {/* Feedback — score once submitted, an entry button once the service is done, else nothing applies yet. */}
                            <span className="text-xs">
                              {it.feedback_score != null ? (
                                <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400" title="Guest feedback score">
                                  <Star className="size-3.5 fill-current" /> {it.feedback_score}/10
                                </span>
                              ) : it.status === 'service_completed' ? (
                                <ActionBtn tip="Record the guest's feedback — a score is required." variant="outline" className="border-violet-500/60 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:text-violet-400 dark:hover:bg-violet-500/10" onClick={() => setFeedbackItem(it)} disabled={pending}><Star className="size-3.5" /> Rate</ActionBtn>
                              ) : (
                                <span className="font-medium text-muted-foreground">—</span>
                              )}
                            </span>
                            <div className="flex flex-wrap items-center gap-1 justify-end">
                              {canRunService && it.status === 'in_service' && (
                                <>
                                  <ActionBtn tip="Mark this service finished — stamps the end time." className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700" onClick={() => doFinishItem(it)} disabled={pending}>Finish</ActionBtn>
                                  <ActionBtn tip="Stop this service with no charge and pick a different one." variant="outline" className="border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10" onClick={() => doSwitchItem(it)} disabled={pending}>Switch</ActionBtn>
                                  <ActionBtn tip="Stop mid-service and decide the charge (none / partial / full / reschedule)." variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => setInterruptItem(it)} disabled={pending}>Interrupt</ActionBtn>
                                </>
                              )}
                              {['interrupted', 'cancelled'].includes(it.status) && !it.switched && !['paid', 'closed', 'void'].includes(order.status) && (
                                <ActionBtn tip="Re-add this service as a fresh line to do again." variant="outline" className="border-indigo-500/60 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-500/10" onClick={() => doRedoItem(it.id)} disabled={pending}>Redo</ActionBtn>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}

              {order.editable && (
                activeCustomer === c.id ? (
                  <div className="mt-3 overflow-x-auto">
                    <div className="min-w-max">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Add service</div>
                      <div className={`${SERVICE_GRID} rounded-lg border border-dashed border-border px-2 py-1.5`}>
                        <ServiceLineEditor
                          draft={{ groupSel, svcId, start: addStart, therapistId, resourceId, roomNo: addRoomNo, discountId, discountOverride }}
                          onChange={(patch) => {
                            if (patch.groupSel !== undefined) setGroupSel(patch.groupSel);
                            if (patch.svcId !== undefined) setSvcId(patch.svcId);
                            if (patch.start !== undefined) setAddStart(patch.start);
                            if (patch.roomNo !== undefined) setAddRoomNo(patch.roomNo);
                            if (patch.therapistId !== undefined) setTherapistId(patch.therapistId);
                            if (patch.resourceId !== undefined) setResourceId(patch.resourceId);
                            if (patch.discountId !== undefined) setDiscountId(patch.discountId);
                            if (patch.discountOverride !== undefined) setDiscountOverride(patch.discountOverride);
                          }}
                          serviceItems={serviceItems}
                          employees={employees}
                          borrowableEmployees={borrowableEmployees}
                          resources={resources}
                          discountClasses={discountClasses}
                          capabilityByEmployee={capabilityByEmployee}
                          busyTherapistIds={busyTherapistIds}
                          busyResourceIds={busyResourceIds}
                          guestGender={guestGenderOf(c)}
                          sourceDiscountLocked={sourceDiscountLocked}
                          defaultDiscountId={defaultDiscountId}
                          dispatch={dispatch}
                          disabled={pending}
                        />
                        <span />
                        <span />
                        <span />
                        <div className="flex flex-wrap items-center gap-1 justify-end">
                          <Button type="button" size="sm" variant="outline" onClick={autoAssign} disabled={pending} title="Fill any empty therapist / station">
                            <Wand2 className="size-3.5" /> Auto
                          </Button>
                          <Button size="sm" onClick={() => doAddItem(c.id)} disabled={pending || !svcId}>Add</Button>
                          <Button size="sm" variant="ghost" onClick={closeItemForm} disabled={pending}>Cancel</Button>
                        </div>
                      </div>
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
                    </div>
                  </div>
                ))}
              </div>
            )}
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
    </div>
    </TooltipProvider>
  );
}
