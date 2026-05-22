'use client';

import { useState, useTransition } from 'react';
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

import { createReservation } from '@/app/(dashboard)/reservations/actions';

interface SourceOpt { id: string; code: string; name: string; phone_required: boolean }
interface BranchOpt { id: string; code: string; name: string; businessUnitIds: string[] }
interface CategoryOpt { id: string; code: string; name: string; businessUnitIds: string[] }

interface Props {
  branches: BranchOpt[];
  sources: SourceOpt[];
  serviceCategories: CategoryOpt[];
  trigger: React.ReactNode;
}

const LOCATION_TYPES = [
  { value: 'on_site', label: 'On-site (branch)' },
  { value: 'external_hotel', label: 'External (hotel room)' },
];

export function NewReservationDialog({ branches, sources, serviceCategories, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Default to WALK-IN if present, else the first source.
  const defaultSourceId = sources.find((s) => s.code === 'WALK-IN')?.id ?? sources[0]?.id ?? '';

  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [sourceId, setSourceId] = useState(defaultSourceId);
  const [serviceCategoryId, setServiceCategoryId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [pax, setPax] = useState('1');
  const [genderPref, setGenderPref] = useState('__none__');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [locationType, setLocationType] = useState('on_site');
  const [note, setNote] = useState('');

  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const sourceOptions = sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
  // Only the service types offered at the chosen branch (category's business
  // units overlap the branch's business units).
  const selectedBranch = branches.find((b) => b.id === branchId) ?? null;
  const branchUnits = selectedBranch?.businessUnitIds ?? [];
  const availableCategories = serviceCategories.filter((c) => c.businessUnitIds.some((u) => branchUnits.includes(u)));
  const categoryOptions = availableCategories.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));

  // Switching branch may invalidate the picked service type.
  function pickBranch(v: string) {
    setBranchId(v);
    const units = branches.find((b) => b.id === v)?.businessUnitIds ?? [];
    const stillValid = serviceCategories.some((c) => c.id === serviceCategoryId && c.businessUnitIds.some((u) => units.includes(u)));
    if (!stillValid) setServiceCategoryId('');
  }

  // Phone is required unless the chosen source handles contact itself (hotels / ENGO).
  const selectedSource = sources.find((s) => s.id === sourceId) ?? null;
  const phoneRequired = selectedSource ? selectedSource.phone_required : true;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId) return toast.error('Pick a customer source');
    if (!serviceCategoryId) return toast.error('Pick a service type');
    if (!start || !end) return toast.error('Pick start and end time');
    if (phoneRequired && !guestPhone.trim()) return toast.error('Phone is required for this source');
    startTransition(async () => {
      const r = await createReservation({
        branch_id: branchId,
        source_id: sourceId,
        service_category_id: serviceCategoryId,
        guest_name: guestName,
        guest_phone: guestPhone || null,
        pax: Number(pax),
        gender_preference: genderPref === '__none__' ? null : genderPref,
        desired_service_start: new Date(start).toISOString(),
        desired_service_end: new Date(end).toISOString(),
        service_location_type: locationType,
        note: note || null,
      });
      if (r.ok) {
        toast.success('Reservation created');
        setOpen(false);
        setGuestName(''); setGuestPhone(''); setStart(''); setEnd(''); setNote(''); setServiceCategoryId('');
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">New Reservation</DialogTitle>
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
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Service Type *</Label>
              <Select items={categoryOptions} value={serviceCategoryId} onValueChange={(v) => v && setServiceCategoryId(v)} disabled={categoryOptions.length === 0}>
                <SelectTrigger><SelectValue placeholder={categoryOptions.length ? 'Massage / Nail / …' : 'No service types at this branch'} /></SelectTrigger>
                <SelectContent>{categoryOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
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
            <Button type="submit" disabled={pending || !branchId}>{pending ? 'Creating…' : 'Create reservation'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
