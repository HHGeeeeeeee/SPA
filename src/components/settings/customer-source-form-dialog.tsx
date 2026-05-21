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

import {
  createCustomerSource,
  updateCustomerSource,
} from '@/app/(dashboard)/settings/customer-sources/actions';

export interface CustomerSourceItem {
  id: string;
  code: string;
  name: string;
  default_billing_to_id: string | null;
  default_discount_class_id: string | null;
}

interface BillingOption {
  id: string;
  code: string;
  name: string;
}

interface DiscountOption {
  id: string;
  code: string;
  description: string;
  discount_percent: number;
  discount_amount_cents: number;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: CustomerSourceItem;
  billingDestinations: BillingOption[];
  discountClasses: DiscountOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function CustomerSourceFormDialog({
  mode = 'create',
  item,
  billingDestinations,
  discountClasses,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();
  const isEdit = mode === 'edit';

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [billingId, setBillingId] = useState(item?.default_billing_to_id ?? NONE);
  const [discountId, setDiscountId] = useState(item?.default_discount_class_id ?? NONE);

  const billingOptions = [
    { value: NONE, label: 'None (customer self-pays)' },
    ...billingDestinations.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })),
  ];
  const discRate = (d: DiscountOption): string | null =>
    d.discount_percent > 0
      ? `${d.discount_percent}%`
      : d.discount_amount_cents > 0
        ? `₱${(d.discount_amount_cents / 100).toLocaleString()}`
        : null;
  const discountOptions = [
    { value: NONE, label: 'None' },
    ...discountClasses.map((d) => {
      const rate = discRate(d);
      return { value: d.id, label: rate ? `${d.code} — ${rate} — ${d.description}` : `${d.code} — ${d.description}` };
    }),
  ];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      name,
      default_billing_to_id: billingId === NONE ? null : billingId,
      default_discount_class_id: discountId === NONE ? null : discountId,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateCustomerSource({ id: item!.id, ...payload })
        : await createCustomerSource(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Source updated' : 'Source created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Source: ${item?.code}` : 'New Customer Source'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              How the customer arrived: WALK-IN, hotel referral, online, etc.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cs-code" className="font-semibold">Code *</Label>
              <Input
                id="cs-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="WALK-IN / H-HOTEL"
                disabled={isEdit}
                required
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cs-name" className="font-semibold">Name *</Label>
              <Input
                id="cs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Walk-in Customer"
                required
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Default Billing To</Label>
              <Select
                items={billingOptions}
                value={billingId ?? NONE}
                onValueChange={(v) => setBillingId(v ?? NONE)}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {billingOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs font-medium text-muted-foreground">
                Auto-fills when this source is selected at order creation.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Default Discount Class</Label>
              <Select
                items={discountOptions}
                value={discountId ?? NONE}
                onValueChange={(v) => setDiscountId(v ?? NONE)}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {discountOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="tabular">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs font-medium text-muted-foreground">
                Auto-applies to OrderItems when this source is used. (Can override per-item.)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
