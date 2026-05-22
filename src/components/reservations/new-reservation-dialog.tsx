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
} from '@/app/(dashboard)/reservations/actions';
import { RESOURCE_TYPE_LABEL } from '@/lib/resource-types';

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
}

interface Props {
  branches: BranchOpt[];
  sources: SourceOpt[];
  serviceCategories: CategoryOpt[];
  mode?: 'create' | 'edit';
  reservation?: ReservationItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  mode = 'create',
  reservation,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
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
    const units = branches.find((b) => b.id === v)?.businessUnitIds ?? [];
    // Drop selected categories not offered at the new branch.
    setCategoryIds((prev) =>
      prev.filter((id) => {
        const c = serviceCategories.find((x) => x.id === id);
        return c?.businessUnitIds.some((u) => units.includes(u));
      }),
    );
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

  // Per resource type needed by the selected categories, vs window capacity.
  const paxNum = Math.max(1, Number(pax) || 1);
  const neededTypes = [
    ...new Set(
      categoryIds
        .map((id) => serviceCategories.find((c) => c.id === id)?.requiredResourceType)
        .filter(Boolean) as string[],
    ),
  ];
  const capacityRows = neededTypes.map((rt) => {
    const cap = avail?.[rt]?.capacity ?? 0;
    const usedOther = avail?.[rt]?.used ?? 0;
    const free = cap - usedOther - paxNum;
    return { rt, cap, usedOther, free, over: usedOther + paxNum > cap };
  });
  const hasOver = capacityRows.some((r) => r.over);
  const missingResourceType = categoryIds.some((id) => !serviceCategories.find((c) => c.id === id)?.requiredResourceType);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId) return toast.error('Pick a customer source');
    if (categoryIds.length === 0) return toast.error('Pick at least one service type');
    if (!start || !end) return toast.error('Pick start and end time');
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
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateReservation({ id: reservation!.id, ...payload })
        : await createReservation(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Reservation updated' : 'Reservation created');
        setOpen(false);
        if (!isEdit) {
          setGuestName(''); setGuestPhone(''); setStart(''); setEnd(''); setNote(''); setCategoryIds([]);
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
            <DialogTitle className="font-bold">{isEdit ? 'Edit Reservation' : 'New Reservation'}</DialogTitle>
            <DialogDescription className="font-medium">Book a slot. Convert to an order at check-in.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch *</Label>
              <Select items={branchOptions} value={branchId} onValueChange={(v) => v && pickBranch(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Source *</Label>
              <Select items={sourceOptions} value={sourceId} onValueChange={(v) => v && setSourceId(v)}>
                <SelectTrigger><SelectValue placeholder="Pick a source" /></SelectTrigger>
                <SelectContent>{sourceOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

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
              <Select value={genderPref} onValueChange={(v) => setGenderPref(v ?? '__none__')}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any</SelectItem>
                  <SelectItem value="M">Male therapist</SelectItem>
                  <SelectItem value="F">Female therapist</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-start" className="font-semibold">Start *</Label>
              <Input id="r-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-end" className="font-semibold">End *</Label>
              <Input id="r-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Location</Label>
              <Select items={LOCATION_TYPES} value={locationType} onValueChange={(v) => v && setLocationType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LOCATION_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="r-note" className="font-semibold">Note</Label>
              <Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || !branchId}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create reservation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
