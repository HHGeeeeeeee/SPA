'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createOrderDirect } from '@/app/(dashboard)/sales-orders/actions';
import type { BoardDialogData } from '@/components/shift-schedule/schedule-board';

const NONE = '__none__';
const ANY = '__any__';

// Base UI's Select resolves the trigger label from `items`, so option lists are
// always { value, label } pairs.
const GENDER_ITEMS = [
  { value: ANY, label: 'Any' },
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
];

// Category-only lines get a fixed duration menu (a concrete service locks its own
// duration instead). Default is 60.
const DEFAULT_DURATION = '60';
const DURATION_ITEMS = [
  { value: '60', label: '60 min' },
  { value: '90', label: '90 min' },
  { value: '120', label: '120 min' },
];

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Current Manila time rounded UP to the next 15-min mark, as "HH:MM".
function nextQuarterPHT(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  let total = h * 60 + m;
  const r = total % 15;
  if (r !== 0) total += 15 - r;
  total %= 24 * 60; // wrap past midnight
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// A guest row in the form: identity + a single service line (category required,
// concrete service optional). `_id` is a stable React key across add/remove.
interface GuestRow {
  _id: number;
  name: string;
  phone: string;
  gender: string; // ANY | 'M' | 'F'
  categoryId: string; // NONE until picked
  serviceItemId: string; // NONE = decide later
  duration: string; // minutes (string for the input); auto-filled from the service
}

interface Props {
  dialog: BoardDialogData;
  /** Branch to default to (the board's current branch). */
  initialBranchId?: string;
  /** Board click-to-add prefill: booked start, and a bed (Station) or therapist
   *  (People) pre-assigned to the first guest's line. */
  prefillStartIso?: string | null;
  prefillResourceId?: string | null;
  prefillTherapistId?: string | null;
  /** Human label for the pre-assignment (bed / therapist name) — shown as a hint. */
  prefillLabel?: string | null;
  /** Standalone (toolbar button) usage: render this as the trigger. */
  trigger?: React.ReactNode;
  /** Controlled usage (board click): the parent owns open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

let GUEST_SEQ = 1;
const newGuest = (): GuestRow => ({
  _id: GUEST_SEQ++, name: '', phone: '', gender: ANY, categoryId: NONE, serviceItemId: NONE, duration: DEFAULT_DURATION,
});

// Compact column label for the dense guest grids; a red asterisk marks the
// fields enforced on submit (name, phone, category).
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="text-[11px] font-semibold text-muted-foreground">
      {children}
      {required && <span className="text-destructive"> *</span>}
    </span>
  );
}

export function CreateOrderDialog({
  dialog, initialBranchId, prefillStartIso, prefillResourceId, prefillTherapistId, prefillLabel,
  trigger, open: openProp, onOpenChange,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const controlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlled ? openProp : internalOpen;
  const setOpen = (o: boolean) => { if (controlled) onOpenChange?.(o); else setInternalOpen(o); };

  const branchDefault = initialBranchId ?? dialog.branches[0]?.id ?? '';
  const walkIn = dialog.sources.find((s) => s.code === 'WALK-IN') ?? null;

  // Split the prefilled ISO into the date + time inputs; with no prefill, default
  // to today + the next 15-min mark (refreshed each time the dialog opens).
  const prefDate = prefillStartIso ? prefillStartIso.slice(0, 10) : todayPHT();
  const prefTime = prefillStartIso ? prefillStartIso.slice(11, 16) : nextQuarterPHT();

  const [branchId, setBranchId] = useState(branchDefault);
  const [sourceId, setSourceId] = useState(walkIn?.id ?? NONE);
  const [date, setDate] = useState(prefDate);
  const [time, setTime] = useState(prefTime);
  const [guests, setGuests] = useState<GuestRow[]>(() => [newGuest()]);

  // Categories valid for the chosen branch (intersect business units; a category
  // with no unit restriction is always offered).
  const branchUnitIds = useMemo(
    () => new Set(dialog.branches.find((b) => b.id === branchId)?.businessUnitIds ?? []),
    [dialog.branches, branchId],
  );
  const categoryItems = useMemo(
    () => [
      { value: NONE, label: 'Select category…' },
      ...dialog.serviceCategories
        .filter((c) => c.businessUnitIds.length === 0 || c.businessUnitIds.some((u) => branchUnitIds.has(u)))
        .map((c) => ({ value: c.id, label: c.name })),
    ],
    [dialog.serviceCategories, branchUnitIds],
  );

  const branchOptions = dialog.branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const sourceOptions = [
    { value: NONE, label: 'None' },
    ...dialog.sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  ];

  function patchGuest(id: number, patch: Partial<GuestRow>) {
    setGuests((prev) => prev.map((g) => (g._id === id ? { ...g, ...patch } : g)));
  }
  function pickCategory(id: number, v: string) {
    // New category → clear the service and reset to the default menu duration.
    patchGuest(id, { categoryId: v, serviceItemId: NONE, duration: DEFAULT_DURATION });
  }
  function pickService(id: number, v: string) {
    // Concrete service → its own duration is authoritative (locked, read-only).
    // Back to "decide later" → fall back to the default menu duration.
    const item = dialog.serviceItems.find((s) => s.id === v);
    patchGuest(id, {
      serviceItemId: v,
      duration: v !== NONE && item?.durationMinutes != null ? String(item.durationMinutes) : DEFAULT_DURATION,
    });
  }
  function addGuest() { setGuests((prev) => [...prev, newGuest()]); }
  function removeGuest(id: number) { setGuests((prev) => (prev.length > 1 ? prev.filter((g) => g._id !== id) : prev)); }

  function reset() {
    setBranchId(branchDefault);
    setSourceId(walkIn?.id ?? NONE);
    setDate(prefDate);
    setTime(prefTime);
    setGuests([newGuest()]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) { toast.error('Pick a branch'); return; }
    if (guests.some((g) => !g.name.trim())) { toast.error('Enter a name for every guest'); return; }
    if (guests.some((g) => !g.phone.trim())) { toast.error('Enter a phone for every guest'); return; }
    if (guests.some((g) => g.categoryId === NONE)) { toast.error('Pick a service category for every guest'); return; }
    const scheduled_start = time ? `${date}T${time}:00+08:00` : null;
    startTransition(async () => {
      const r = await createOrderDirect({
        branch_id: branchId,
        source_id: sourceId === NONE ? null : sourceId,
        service_date: date,
        scheduled_start,
        guests: guests.map((g, i) => ({
          name: g.name.trim() || null,
          phone: g.phone.trim() || null,
          gender: g.gender === ANY ? null : g.gender,
          service_category_id: g.categoryId,
          service_item_id: g.serviceItemId === NONE ? null : g.serviceItemId,
          // A concrete service locks its own duration server-side → send null;
          // a category-only line carries the chosen menu duration.
          duration_minutes: g.serviceItemId === NONE ? Number(g.duration || DEFAULT_DURATION) : null,
          // Board click pre-assigns the first guest's line only.
          resource_id: i === 0 ? (prefillResourceId ?? null) : null,
          therapist_id: i === 0 ? (prefillTherapistId ?? null) : null,
        })),
      });
      if (r.ok && r.data) {
        setOpen(false);
        router.push(`/sales-orders/${r.data.orderId}`);
      } else if (!r.ok) {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Opening the standalone dialog → snap Date/Time to now + next 15 min so a
        // dialog left mounted since page load isn't stale. Board prefill is kept.
        if (o && !prefillStartIso) { setDate(todayPHT()); setTime(nextQuarterPHT()); }
        if (!o) reset();
      }}
    >
      {trigger && <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />}
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">Create Order</DialogTitle>
            <DialogDescription className="font-medium">
              Opens the order straight away — assign beds &amp; therapists on the board or inside the order.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {/* Branch · Source */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="font-semibold">Branch *</Label>
                <Select items={branchOptions} value={branchId} onValueChange={(v) => v && setBranchId(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="font-semibold">Source</Label>
                <Select items={sourceOptions} value={sourceId} onValueChange={(v) => setSourceId(v ?? NONE)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date · Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="co-date" className="font-semibold">Date *</Label>
                <Input id="co-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="co-time" className="font-semibold">Time</Label>
                <Input id="co-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>

            {prefillLabel && (
              <p className="text-[12px] font-medium text-muted-foreground">
                Pre-assigned to <span className="font-bold text-foreground">{prefillLabel}</span> (first guest).
              </p>
            )}

            {/* Guests — each is a service line: name/phone/gender + category/service/duration */}
            <div className="flex flex-col gap-3">
              {guests.map((g, i) => {
                const svcOptions = [
                  { value: NONE, label: 'Decide later' },
                  ...dialog.serviceItems
                    .filter((s) => s.categoryId === g.categoryId)
                    .map((s) => ({ value: s.id, label: s.name })),
                ];
                return (
                  <div key={g._id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Guest {i + 1}</span>
                      {guests.length > 1 && (
                        <button type="button" onClick={() => removeGuest(g._id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove guest">
                          <X className="size-4" />
                        </button>
                      )}
                    </div>

                    {/* name · phone · gender */}
                    <div className="grid grid-cols-[1fr_1fr_8rem] gap-2 mb-1">
                      <FieldLabel required>Name</FieldLabel>
                      <FieldLabel required>Phone</FieldLabel>
                      <FieldLabel>Gender</FieldLabel>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_8rem] gap-2">
                      <Input placeholder={`Guest ${i + 1}`} value={g.name} onChange={(e) => patchGuest(g._id, { name: e.target.value })} />
                      <Input placeholder="Phone" value={g.phone} onChange={(e) => patchGuest(g._id, { phone: e.target.value })} />
                      <Select items={GENDER_ITEMS} value={g.gender} onValueChange={(v) => patchGuest(g._id, { gender: v ?? ANY })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GENDER_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* category · service · duration */}
                    <div className="mt-2 grid grid-cols-[1fr_1fr_8rem] gap-2 mb-1">
                      <FieldLabel required>Category</FieldLabel>
                      <FieldLabel>Service</FieldLabel>
                      <FieldLabel>Duration</FieldLabel>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_8rem] gap-2">
                      <Select items={categoryItems} value={g.categoryId} onValueChange={(v) => v && pickCategory(g._id, v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {categoryItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select
                        items={svcOptions}
                        value={g.serviceItemId}
                        onValueChange={(v) => pickService(g._id, v ?? NONE)}
                        disabled={g.categoryId === NONE}
                      >
                        <SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger>
                        <SelectContent>
                          {svcOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {g.serviceItemId !== NONE ? (
                        // Concrete service picked → duration is the service's, locked.
                        <div className="flex h-8 items-center rounded-lg border border-input bg-muted/40 px-2.5 text-sm font-semibold text-muted-foreground" title="Set by the service">
                          {g.duration || '—'} min
                        </div>
                      ) : (
                        <Select items={DURATION_ITEMS} value={g.duration} onValueChange={(v) => patchGuest(g._id, { duration: v ?? DEFAULT_DURATION })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DURATION_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" className="self-start gap-1.5" onClick={addGuest}>
                <Plus className="size-4" /> Add guest
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || !branchId}>
              {pending ? 'Creating…' : 'Create order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}