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

interface Opt { id: string; code: string; name: string }

interface Props {
  branches: Opt[];
  sources: Opt[];
  trigger: React.ReactNode;
}

const NONE = '__none__';
const SOURCE_TYPES = [
  { value: 'phone', label: 'Phone' },
  { value: 'hotel_proxy', label: 'Hotel Front Desk' },
  { value: 'online_self', label: 'Online (self)' },
  { value: 'walkin', label: 'Walk-in' },
];
const LOCATION_TYPES = [
  { value: 'on_site', label: 'On-site (branch)' },
  { value: 'external_hotel', label: 'External (hotel room)' },
];

export function NewReservationDialog({ branches, sources, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [sourceType, setSourceType] = useState('phone');
  const [sourceId, setSourceId] = useState(NONE);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [pax, setPax] = useState('1');
  const [genderPref, setGenderPref] = useState(NONE);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [locationType, setLocationType] = useState('on_site');
  const [note, setNote] = useState('');

  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const sourceOptions = [{ value: NONE, label: 'None' }, ...sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || !end) return toast.error('Pick start and end time');
    startTransition(async () => {
      const r = await createReservation({
        branch_id: branchId,
        source_type: sourceType,
        source_id: sourceId === NONE ? null : sourceId,
        guest_name: guestName,
        guest_phone: guestPhone || null,
        pax: Number(pax),
        gender_preference: genderPref === NONE ? null : genderPref,
        desired_service_start: new Date(start).toISOString(),
        desired_service_end: new Date(end).toISOString(),
        service_location_type: locationType,
        note: note || null,
      });
      if (r.ok) {
        toast.success('Reservation created');
        setOpen(false);
        setGuestName(''); setGuestPhone(''); setStart(''); setEnd(''); setNote('');
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
              <Select items={branchOptions} value={branchId} onValueChange={(v) => v && setBranchId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Source *</Label>
              <Select items={SOURCE_TYPES} value={sourceType} onValueChange={(v) => v && setSourceType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCE_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-name" className="font-semibold">Guest Name *</Label>
              <Input id="r-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-phone" className="font-semibold">Phone</Label>
              <Input id="r-phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} maxLength={40} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-pax" className="font-semibold">PAX *</Label>
              <Input id="r-pax" type="number" min="1" max="50" value={pax} onChange={(e) => setPax(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Gender Preference</Label>
              <Select value={genderPref} onValueChange={(v) => setGenderPref(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Any</SelectItem>
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
