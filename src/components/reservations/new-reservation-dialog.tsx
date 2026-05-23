'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  createReservation,
  updateReservation,
  getReservationAvailability,
  getFreeBeds,
  nextAvailableSlot,
} from '@/app/(dashboard)/reservations/actions';
import { RESOURCE_TYPE_LABEL } from '@/lib/resource-types';

interface FreeBed { id: string; name: string; type: string; zone: string; free: boolean }
// Trailing number in "Bed #3" → 3, for natural sort + adjacency runs.
function bedNum(name: string): number { const m = name.match(/(\d+)/); return m ? Number(m[1]) : 9999; }

interface SourceOpt { id: string; code: string; name: string; phone_required: boolean }
interface BranchOpt { id: string; code: string; name: string; businessUnitIds: string[] }
interface CategoryOpt { id: string; code: string; name: string; businessUnitIds: string[]; requiredResourceType: string | null }

export interface ReservationItem {
  id: string;
  branch_id: string;
  source_id: string | null;
  service_category_ids: string[];
  guest_name: string;
  guest_phone: string | null;
  pax: number;
  gender_preference: string | null;
  service_location_type: string | null;
  note: string | null;
  desired_service_start: string;
  desired_service_end: string;
  resource_ids?: string[];
  seat_together?: boolean;
}

interface Props {
  branches: BranchOpt[];
  sources: SourceOpt[];
  serviceCategories: CategoryOpt[];
  serviceItems?: { id: string; name: string; group: string; categoryId: string }[];
  mode?: 'create' | 'edit';
  reservation?: ReservationItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Walk-in mode: a streamlined flow that books the soonest available slot and
  // hides the manual Start/End + Location fields.
  walkIn?: boolean;
}

const LOCATION_TYPES = [
  { value: 'on_site', label: 'On-site (branch)' },
  { value: 'external_hotel', label: 'External (hotel room)' },
];
const rtLabel = (rt: string) => RESOURCE_TYPE_LABEL[rt] ?? rt;

// ISO timestamp → "YYYY-MM-DDTHH:mm" in local (browser) time for datetime-local.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewReservationDialog({
  branches,
  sources,
  serviceCategories,
  serviceItems = [],
  mode = 'create',
  reservation,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  walkIn = false,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const isEdit = mode === 'edit';
  const [pending, startTransition] = useTransition();

  const defaultSourceId = sources.find((s) => s.code === 'WALK-IN')?.id ?? sources[0]?.id ?? '';

  const [branchId, setBranchId] = useState(reservation?.branch_id ?? branches[0]?.id ?? '');
  const [sourceId, setSourceId] = useState(reservation?.source_id ?? defaultSourceId);
  const [categoryIds, setCategoryIds] = useState<string[]>(reservation?.service_category_ids ?? []);
  const [guestName, setGuestName] = useState(reservation?.guest_name ?? '');
  const [guestPhone, setGuestPhone] = useState(reservation?.guest_phone ?? '');
  const [pax, setPax] = useState(String(reservation?.pax ?? 1));
  const [genderPref, setGenderPref] = useState(reservation?.gender_preference ?? '__none__');
  const [start, setStart] = useState(reservation ? toLocalInput(reservation.desired_service_start) : '');
  const [end, setEnd] = useState(reservation ? toLocalInput(reservation.desired_service_end) : '');
  const [locationType, setLocationType] = useState(reservation?.service_location_type ?? 'on_site');
  const [note, setNote] = useState(reservation?.note ?? '');
  // Booking-side intent (groups who want to sit together → system auto-assigns
  // adjacent beds). Staff can override the actual beds via the picker below.
  const [seatTogether, setSeatTogether] = useState(reservation?.seat_together ?? false);
  const [pinnedBeds, setPinnedBeds] = useState<string[]>(reservation?.resource_ids ?? []);
  // Beds stay hidden until staff explicitly opens the picker — opening a
  // reservation never reveals bed numbers on its own.
  const [showBedPicker, setShowBedPicker] = useState(false);
  const [beds, setBeds] = useState<FreeBed[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [walkInMsg, setWalkInMsg] = useState<string | null>(null);
  const [specificGroup, setSpecificGroup] = useState(''); // '' = any service in the category

  // Capacity snapshot for the chosen branch + window (used per resource type).
  const [avail, setAvail] = useState<Record<string, { capacity: number; used: number }> | null>(null);

  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const sourceOptions = sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
  const selectedBranch = branches.find((b) => b.id === branchId) ?? null;
  const branchUnits = selectedBranch?.businessUnitIds ?? [];
  const availableCategories = serviceCategories.filter((c) => c.businessUnitIds.some((u) => branchUnits.includes(u)));

  function toggleCategory(id: string) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function pickBranch(v: string) {
    setBranchId(v);
    setPinnedBeds([]); // beds belong to a branch; clear when switching
    const units = branches.find((b) => b.id === v)?.businessUnitIds ?? [];
    // Drop selected categories not offered at the new branch.
    setCategoryIds((prev) =>
      prev.filter((id) => {
        const c = serviceCategories.find((x) => x.id === id);
        return c?.businessUnitIds.some((u) => units.includes(u));
      }),
    );
  }

  function pickLocation(v: string) {
    setLocationType(v);
    if (v === 'external_hotel') setPinnedBeds([]); // in-room: no branch bed
  }

  const selectedSource = sources.find((s) => s.id === sourceId) ?? null;
  const phoneRequired = selectedSource ? selectedSource.phone_required : true;

  // Refresh the capacity snapshot when branch/time changes (debounced).
  useEffect(() => {
    if (!open || !branchId || !start || !end) { setAvail(null); return; }
    if (new Date(end) <= new Date(start)) return;
    const t = setTimeout(async () => {
      const r = await getReservationAvailability({
        branch_id: branchId,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        exclude_id: reservation?.id ?? null,
      });
      if (r.ok && r.data) setAvail(r.data.byType);
    }, 350);
    return () => clearTimeout(t);
  }, [open, branchId, start, end, reservation?.id]);

  // Free/busy beds for the optional pin picker (on-site only).
  useEffect(() => {
    if (!open || locationType !== 'on_site' || !branchId || !start || !end) { setBeds(null); return; }
    if (new Date(end) <= new Date(start)) return;
    const t = setTimeout(async () => {
      const r = await getFreeBeds({
        branch_id: branchId,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        exclude_id: reservation?.id ?? null,
      });
      if (r.ok && r.data) setBeds(r.data.beds);
    }, 350);
    return () => clearTimeout(t);
  }, [open, locationType, branchId, start, end, reservation?.id]);

  // Per resource type needed by the selected categories, vs window capacity.
  const paxNum = Math.max(1, Number(pax) || 1);
  const neededTypes = [
    ...new Set(
      categoryIds
        .map((id) => serviceCategories.find((c) => c.id === id)?.requiredResourceType)
        .filter(Boolean) as string[],
    ),
  ];
  // The category that drives the bed type + therapist skill, and its specific
  // service groups (so a walk-in can narrow to e.g. "Thai Massage").
  const cat0 = serviceCategories.find((c) => categoryIds.includes(c.id) && c.requiredResourceType === neededTypes[0]) ?? null;
  const groupChoices = cat0 ? [...new Set(serviceItems.filter((s) => s.categoryId === cat0.id).map((s) => s.group))].sort() : [];
  const capacityRows = neededTypes.map((rt) => {
    const cap = avail?.[rt]?.capacity ?? 0;
    const usedOther = avail?.[rt]?.used ?? 0;
    const free = cap - usedOther - paxNum;
    return { rt, cap, usedOther, free, over: usedOther + paxNum > cap };
  });
  const hasOver = capacityRows.some((r) => r.over);
  const missingResourceType = categoryIds.some((id) => !serviceCategories.find((c) => c.id === id)?.requiredResourceType);

  // Beds the picker offers = active resources of the types this reservation needs.
  // Sorted by zone then number so same-zone beds cluster (adjacency reads naturally).
  const pinnableBeds = (beds ?? []).filter((b) => neededTypes.includes(b.type));
  const bedsByType = neededTypes
    .map((rt) => ({
      rt,
      list: pinnableBeds.filter((b) => b.type === rt)
        .sort((a, b) => (a.zone === b.zone ? bedNum(a.name) - bedNum(b.name) : a.zone.localeCompare(b.zone))),
    }))
    .filter((g) => g.list.length > 0);
  const isFreeOrMine = (b: FreeBed) => b.free || pinnedBeds.includes(b.id);

  function toggleBed(id: string) {
    setPinnedBeds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= paxNum) { toast.error(`Can't pin more than ${paxNum} bed(s) for ${paxNum} pax`); return prev; }
      return [...prev, id];
    });
  }

  // Pick `pax` "together" beds in a type group: a consecutive-number run inside a
  // single zone first, then any free beds in one zone, then any free of the type.
  function pickAdjacent(list: FreeBed[]) {
    const n = paxNum;
    const zones = [...new Set(list.map((b) => b.zone))];
    const runInZone = (zoneBeds: FreeBed[]): string[] => {
      const sorted = [...zoneBeds].sort((a, b) => bedNum(a.name) - bedNum(b.name));
      for (let i = 0; i + n <= sorted.length; i++) {
        const win = sorted.slice(i, i + n);
        const ok = win.every((b, k) => k === 0 || bedNum(b.name) - bedNum(win[k - 1].name) === 1);
        if (ok && win.every(isFreeOrMine)) return win.map((b) => b.id);
      }
      return [];
    };
    let chosen: string[] = [];
    for (const z of zones) { chosen = runInZone(list.filter((b) => b.zone === z)); if (chosen.length) break; }
    if (chosen.length === 0) {
      for (const z of zones) {
        const free = list.filter((b) => b.zone === z && isFreeOrMine(b)).slice(0, n);
        if (free.length === n) { chosen = free.map((b) => b.id); break; }
      }
    }
    if (chosen.length === 0) chosen = list.filter(isFreeOrMine).slice(0, n).map((b) => b.id);
    if (chosen.length === 0) { toast.error('No free beds of this type for the window'); return; }
    const typeIds = new Set(list.map((b) => b.id));
    setPinnedBeds((prev) => [...prev.filter((id) => !typeIds.has(id)), ...chosen]);
  }

  // Walk-in helper: find the soonest time `pax` stations of the needed type AND
  // matching therapists are free (60-min probe) and fill start/end. `silent` =
  // auto-run (no toast); the result is shown inline via walkInMsg.
  async function findNextAvailable(silent = false) {
    if (!branchId) { if (!silent) toast.error('Pick a branch first'); return; }
    if (neededTypes.length === 0) { setStart(''); setEnd(''); setWalkInMsg('Pick a service type first.'); return; }
    setFinding(true);
    const r = await nextAvailableSlot({
      branch_id: branchId,
      resource_type: neededTypes[0],
      service_category_id: cat0?.id ?? null,
      service_group: specificGroup || null, // narrow to a specific service if chosen
      pax: paxNum,
      durationMin: 60,
      gender: genderPref === '__none__' ? null : genderPref,
    });
    setFinding(false);
    if (!r.ok) { setStart(''); setEnd(''); setWalkInMsg(r.error); if (!silent) toast.error(r.error); return; }
    if (!r.data?.start) {
      setStart(''); setEnd('');
      setWalkInMsg('No slot within 24h — not enough free beds + on-shift therapists for this party.');
      return;
    }
    const startMs = Date.parse(r.data.start);
    setStart(toLocalInput(r.data.start));
    setEnd(toLocalInput(new Date(startMs + 60 * 60000).toISOString()));
    const when = new Date(startMs).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    setWalkInMsg(r.data.availableNow ? `A spot is free now (${when})` : `Soonest available: ${when}`);
    if (!silent) toast.success(r.data.availableNow ? 'A spot is free now' : `Soonest ~${when}`);
  }

  // In walk-in mode, auto-recompute the soonest slot as the branch / service /
  // pax / gender change.
  const catKey = categoryIds.join(',');
  useEffect(() => {
    if (!walkIn || !open) return;
    const t = setTimeout(() => { void findNextAvailable(true); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkIn, open, branchId, catKey, paxNum, genderPref, specificGroup]);
  // Clear a stale specific-service when the category set changes.
  useEffect(() => { setSpecificGroup(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [catKey]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId) return toast.error('Pick a customer source');
    if (categoryIds.length === 0) return toast.error('Pick at least one service type');
    if (!start || !end) return toast.error(walkIn ? 'No available slot — adjust service type / pax / gender.' : 'Pick start and end time');
    if (phoneRequired && !guestPhone.trim()) return toast.error('Phone is required for this source');
    const payload = {
      branch_id: branchId,
      source_id: sourceId,
      service_category_ids: categoryIds,
      guest_name: guestName,
      guest_phone: guestPhone || null,
      pax: paxNum,
      gender_preference: genderPref === '__none__' ? null : genderPref,
      desired_service_start: new Date(start).toISOString(),
      desired_service_end: new Date(end).toISOString(),
      service_location_type: locationType,
      note: note || null,
      resource_ids: locationType === 'external_hotel' ? [] : pinnedBeds,
      seat_together: locationType === 'external_hotel' ? false : seatTogether && paxNum > 1,
      confirmed: walkIn, // walk-in guest is present → established, not pending
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateReservation({ id: reservation!.id, ...payload })
        : await createReservation(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Reservation updated' : walkIn ? 'Walk-in booked (confirmed)' : 'Reservation created');
        setOpen(false);
        if (!isEdit) {
          setGuestName(''); setGuestPhone(''); setStart(''); setEnd(''); setNote(''); setCategoryIds([]); setPinnedBeds([]); setSeatTogether(false); setShowBedPicker(false); setWalkInMsg(null);
        }
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} /> : null}
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">{isEdit ? 'Edit Reservation' : walkIn ? 'Walk-in / Waiting' : 'New Reservation'}</DialogTitle>
            <DialogDescription className="font-medium">
              {walkIn ? 'Guest is here — seat now or wait for the soonest available time.' : 'Book a slot. Convert to an order at check-in.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className={`flex flex-col gap-2${walkIn ? ' col-span-2' : ''}`}>
              <Label className="font-semibold">Branch *</Label>
              <Select items={branchOptions} value={branchId} onValueChange={(v) => v && pickBranch(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!walkIn && (
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Source *</Label>
                <Select items={sourceOptions} value={sourceId} onValueChange={(v) => v && setSourceId(v)}>
                  <SelectTrigger><SelectValue placeholder="Pick a source" /></SelectTrigger>
                  <SelectContent>{sourceOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Service Types *</Label>
              <div className="flex flex-col gap-1 rounded-lg border border-input p-2">
                {availableCategories.length === 0 ? (
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">No service types at this branch.</p>
                ) : (
                  availableCategories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={categoryIds.includes(c.id)}
                        onChange={() => toggleCategory(c.id)}
                      />
                      <span className="text-sm font-semibold">{c.name}</span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {c.requiredResourceType ? rtLabel(c.requiredResourceType) : 'no resource set'}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Walk-in: optionally narrow to a specific service for tighter
                therapist-skill matching (else any service in the category). */}
            {walkIn && groupChoices.length > 1 && (
              <div className="flex flex-col gap-2 col-span-2">
                <Label className="font-semibold">Specific service <span className="font-medium text-muted-foreground">(optional)</span></Label>
                <Select
                  items={[{ value: '__any__', label: `Any ${cat0?.name ?? 'service'}` }, ...groupChoices.map((g) => ({ value: g, label: g }))]}
                  value={specificGroup || '__any__'}
                  onValueChange={(v) => setSpecificGroup(v === '__any__' ? '' : (v ?? ''))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any {cat0?.name ?? 'service'}</SelectItem>
                    {groupChoices.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs font-medium text-muted-foreground">Pick the exact service to only match therapists who can do it.</p>
              </div>
            )}

            {/* Soft capacity check for the window — never blocks, just warns. */}
            {capacityRows.length > 0 && (
              <div className={`col-span-2 rounded-lg border p-3 text-sm ${hasOver ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-muted/30'}`}>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Capacity for this window · {paxNum} pax
                </p>
                <div className="flex flex-col gap-1">
                  {capacityRows.map((r) => (
                    <div key={r.rt} className="flex items-center justify-between">
                      <span className="font-semibold">{rtLabel(r.rt)}</span>
                      <span className={`font-bold tabular ${r.over ? 'text-destructive' : 'text-foreground'}`}>
                        {r.over
                          ? `over by ${r.usedOther + paxNum - r.cap} (${r.usedOther}+${paxNum} / ${r.cap})`
                          : `${Math.max(0, r.free)} free (${r.usedOther}+${paxNum} / ${r.cap})`}
                      </span>
                    </div>
                  ))}
                </div>
                {hasOver && <p className="text-xs font-semibold text-destructive mt-1.5">Over capacity — you can still book, but resources may be short.</p>}
                {!avail && <p className="text-xs font-medium text-muted-foreground mt-1.5">Checking…</p>}
              </div>
            )}
            {missingResourceType && (
              <p className="col-span-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                Some picked types have no resource set — capacity can&apos;t be checked for them. Set it in Settings → Service Categories.
              </p>
            )}

            {/* Beds: the booker only chooses "sit together" for a group — the
                system auto-assigns adjacent beds. Staff can override the actual
                beds via the optional picker. In-room (external) uses no bed. */}
            {locationType === 'on_site' && (
              <div className="col-span-2 rounded-lg border border-border bg-muted/30 p-3">
                {paxNum > 1 ? (
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 cursor-pointer accent-primary"
                      checked={seatTogether}
                      onChange={(e) => setSeatTogether(e.target.checked)}
                    />
                    <span>
                      <span className="text-sm font-semibold">Seat the group together</span>
                      <span className="block text-xs font-medium text-muted-foreground">
                        Reserve {paxNum} adjacent beds automatically. Otherwise a bed is assigned at check-in.
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="text-xs font-medium text-muted-foreground">
                    A bed is assigned automatically at check-in.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setShowBedPicker((v) => !v)}
                  className="mt-2 text-xs font-bold text-primary hover:underline"
                >
                  {showBedPicker ? 'Hide bed assignment ▲' : 'Adjust beds (staff) ▾'}
                </button>

                {showBedPicker && (
                  <div className="mt-2 border-t border-border pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Assign specific beds</p>
                      <span className="text-xs font-bold tabular text-muted-foreground">{pinnedBeds.length} / {paxNum} pinned</span>
                    </div>
                    {bedsByType.length === 0 ? (
                      <p className="text-xs font-medium text-muted-foreground">Pick service type(s) and a time to list beds.</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {bedsByType.map((g) => (
                          <div key={g.rt}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-foreground">{rtLabel(g.rt)}</span>
                              {paxNum > 1 && (
                                <button type="button" onClick={() => pickAdjacent(g.list)} className="text-xs font-bold text-primary hover:underline">
                                  Pick {paxNum} adjacent free
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {g.list.map((b) => {
                                const picked = pinnedBeds.includes(b.id);
                                const disabled = !isFreeOrMine(b);
                                return (
                                  <button
                                    key={b.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => toggleBed(b.id)}
                                    title={disabled ? 'Taken for this window' : b.zone ? `Zone ${b.zone}` : undefined}
                                    className={
                                      picked
                                        ? 'rounded-md border border-violet-500 bg-violet-500/20 px-2 py-1 text-xs font-bold text-violet-700 dark:text-violet-200'
                                        : disabled
                                          ? 'rounded-md border border-dashed border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground/50 line-through cursor-not-allowed'
                                          : 'rounded-md border border-input bg-card px-2 py-1 text-xs font-semibold hover:bg-accent'
                                    }
                                  >
                                    {b.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {beds === null && <p className="text-xs font-medium text-muted-foreground mt-1.5">Loading beds…</p>}
                    <p className="text-xs font-medium text-muted-foreground mt-2">Picking beds here overrides the automatic assignment.</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="r-name" className="font-semibold">Guest Name *</Label>
              <Input id="r-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-phone" className="font-semibold">
                Phone {phoneRequired ? <span className="text-destructive">*</span> : <span className="font-medium text-muted-foreground">(optional)</span>}
              </Label>
              <Input id="r-phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} maxLength={40} required={phoneRequired} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-pax" className="font-semibold">PAX *</Label>
              <Input id="r-pax" type="number" min="1" max="50" value={pax} onChange={(e) => setPax(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Gender Preference</Label>
              <Select items={[{ value: '__none__', label: 'Any' }, { value: 'M', label: 'Male therapist' }, { value: 'F', label: 'Female therapist' }]} value={genderPref} onValueChange={(v) => setGenderPref(v ?? '__none__')}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any</SelectItem>
                  <SelectItem value="M">Male therapist</SelectItem>
                  <SelectItem value="F">Female therapist</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {walkIn ? (
              <div className="col-span-2 rounded-lg border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-bold">{finding ? 'Finding soonest…' : walkInMsg ?? 'Pick a service type & pax to find the soonest slot.'}</div>
                  <div className="text-xs font-medium text-muted-foreground">Beds + on-shift therapists (skill / gender) are considered.</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => findNextAvailable(false)} disabled={finding || !branchId}>
                  {finding ? '…' : 'Refresh'}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="r-start" className="font-semibold">Start *</Label>
                  <Input id="r-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="r-end" className="font-semibold">End *</Label>
                  <Input id="r-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
                </div>
              </>
            )}
            {!walkIn && (
              <div className="flex flex-col gap-2 col-span-2">
                <Label className="font-semibold">Location</Label>
                <Select items={LOCATION_TYPES} value={locationType} onValueChange={(v) => v && pickLocation(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LOCATION_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="r-note" className="font-semibold">Note</Label>
              <Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || !branchId}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : walkIn ? 'Book walk-in' : 'Create reservation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
