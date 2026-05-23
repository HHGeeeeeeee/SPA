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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createCustomer, updateCustomer } from '@/app/(dashboard)/customers/actions';

export interface CustomerItem {
  id: string;
  phone: string;
  name: string;
  gender: string | null;
  email: string | null;
  dob: string | null;
  customer_type: string | null;
  primary_business_unit_id: string | null;
}

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  customer?: CustomerItem;
  businessUnits: BusinessUnitOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function CustomerFormDialog({
  mode = 'create',
  customer,
  businessUnits,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();
  const isEdit = mode === 'edit';

  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [gender, setGender] = useState(customer?.gender ?? NONE);
  const [email, setEmail] = useState(customer?.email ?? '');
  const [dob, setDob] = useState(customer?.dob ?? '');
  const [customerType, setCustomerType] = useState(customer?.customer_type ?? '');
  const [buId, setBuId] = useState(customer?.primary_business_unit_id ?? businessUnits[0]?.id ?? NONE);

  const buOptions = [
    { value: NONE, label: 'None' },
    ...businessUnits.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })),
  ];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        phone,
        name,
        gender: gender === NONE ? null : gender,
        email: email || null,
        dob: dob || null,
        customer_type: customerType || null,
        primary_business_unit_id: buId === NONE ? null : buId,
      };
      const r = isEdit
        ? await updateCustomer({ id: customer!.id, ...payload })
        : await createCustomer(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Customer updated' : 'Customer created');
        setOpen(false);
        if (!isEdit) { setPhone(''); setName(''); setEmail(''); setDob(''); setCustomerType(''); }
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger as React.ReactElement} /> : null}
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Customer: ${customer?.name}` : 'New Customer'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Customer master for repeat guests, stored-value cardholders, and future members.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-phone" className="font-semibold">Phone *</Label>
              <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="63917..." disabled={isEdit} required maxLength={40} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-name" className="font-semibold">Name *</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Gender</Label>
              <Select items={[{ value: NONE, label: '—' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'Other', label: 'Other' }]} value={gender ?? NONE} onValueChange={(v) => setGender(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="M">Male</SelectItem>
                  <SelectItem value="F">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-dob" className="font-semibold">Date of Birth</Label>
              <Input id="c-dob" type="date" value={dob ?? ''} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-email" className="font-semibold">Email</Label>
              <Input id="c-email" type="email" value={email ?? ''} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-type" className="font-semibold">Customer Type</Label>
              <Input id="c-type" value={customerType ?? ''} onChange={(e) => setCustomerType(e.target.value)}
                placeholder="VIP / Member / …" maxLength={40} />
            </div>
            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Primary Business Unit</Label>
              <Select items={buOptions} value={buId ?? NONE} onValueChange={(v) => setBuId(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {buOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
