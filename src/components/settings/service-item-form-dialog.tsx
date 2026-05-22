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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createServiceItem, updateServiceItem } from '@/app/(dashboard)/settings/service-items/actions';
import { RESOURCE_TYPES } from '@/lib/resource-types';

export interface ServiceItemRecord {
  id: string;
  code: string;
  name: string;
  service_group: string | null;
  service_category_id: string;
  duration_minutes: number;
  prep_before_minutes: number;
  cleanup_after_minutes: number;
  required_resource_type: string | null;
  pricing_model: 'per_session' | 'membership_unlimited' | 'membership_quota' | 'subscription';
  commission_applicable: boolean;
  tip_applicable: boolean;
  business_unit_id: string | null;
  price_cents: number | null;
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
}

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: ServiceItemRecord;
  categories: CategoryOption[];
  businessUnits: BusinessUnitOption[];
  groups?: string[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function ServiceItemFormDialog({
  mode = 'create',
  item,
  categories,
  businessUnits,
  groups = [],
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [serviceGroup, setServiceGroup] = useState(item?.service_group ?? '');
  const [categoryId, setCategoryId] = useState(item?.service_category_id ?? categories[0]?.id ?? '');
  const [duration, setDuration] = useState(String(item?.duration_minutes ?? 60));
  const [prep, setPrep] = useState(String(item?.prep_before_minutes ?? 10));
  const [cleanup, setCleanup] = useState(String(item?.cleanup_after_minutes ?? 15));
  const [resourceType, setResourceType] = useState(item?.required_resource_type ?? 'massage_bed');
  const [pricingModel, setPricingModel] = useState<ServiceItemRecord['pricing_model']>(
    item?.pricing_model ?? 'per_session',
  );
  const [commissionApplicable, setCommissionApplicable] = useState(item?.commission_applicable ?? true);
  const [tipApplicable, setTipApplicable] = useState(item?.tip_applicable ?? true);
  const [businessUnitId, setBusinessUnitId] = useState(item?.business_unit_id ?? businessUnits[0]?.id ?? '');
  const [price, setPrice] = useState(item?.price_cents != null ? String(item.price_cents / 100) : '');

  const categoryOptions = categories.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
  const businessUnitOptions = businessUnits.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  const isEdit = mode === 'edit';
  const slotMinutes = Number(duration || 0) + Number(prep || 0) + Number(cleanup || 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      name,
      service_group: serviceGroup || null,
      service_category_id: categoryId,
      duration_minutes: Number(duration),
      prep_before_minutes: Number(prep),
      cleanup_after_minutes: Number(cleanup),
      required_resource_type: resourceType === NONE ? null : resourceType,
      pricing_model: pricingModel,
      commission_applicable: commissionApplicable,
      tip_applicable: tipApplicable,
      business_unit_id: businessUnitId || null,
      price: price === '' ? undefined : Number(price),
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateServiceItem({ id: item!.id, ...payload })
        : await createServiceItem(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Service item updated' : 'Service item created');
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
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Service: ${item?.code}` : 'New Service Item'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit ? 'Code is immutable.' : 'Define a service customers can order.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="si-code" className="font-semibold">Code *</Label>
              <Input
                id="si-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="M60T"
                disabled={isEdit}
                required
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Category *</Label>
              <Select items={categoryOptions} value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="si-name" className="font-semibold">Name *</Label>
              <Input
                id="si-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Thai Massage 60min"
                required
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="si-group" className="font-semibold">Service Group</Label>
              <Input
                id="si-group"
                list="si-group-list"
                value={serviceGroup}
                onChange={(e) => setServiceGroup(e.target.value)}
                placeholder="Thai Massage"
                maxLength={80}
              />
              <datalist id="si-group-list">
                {groups.map((g) => <option key={g} value={g} />)}
              </datalist>
              <p className="text-xs font-medium text-muted-foreground">
                Groups duration variants of the same service. The order screen lets staff
                pick the group, then the duration.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Business Unit *</Label>
              <Select items={businessUnitOptions} value={businessUnitId} onValueChange={(v) => v && setBusinessUnitId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {businessUnitOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="si-price" className="font-semibold">Price (₱) *</Label>
              <Input
                id="si-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="1000"
                required
              />
              <p className="text-xs font-medium text-muted-foreground">
                List price (Normal, all branches). Used as the line price at checkout.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="si-dur" className="font-semibold">Duration (min) *</Label>
              <Input
                id="si-dur"
                type="number"
                min="1"
                max="600"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Station Type</Label>
              <Select
                value={resourceType ?? NONE}
                onValueChange={(v) => setResourceType(v ?? NONE)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {RESOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="si-prep" className="font-semibold">Prep (min)</Label>
              <Input
                id="si-prep"
                type="number"
                min="0"
                max="120"
                value={prep}
                onChange={(e) => setPrep(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="si-clean" className="font-semibold">Cleanup (min)</Label>
              <Input
                id="si-clean"
                type="number"
                min="0"
                max="120"
                value={cleanup}
                onChange={(e) => setCleanup(e.target.value)}
              />
            </div>

            <div className="col-span-2 rounded-lg border border-border p-3 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Total Slot Time (Schedule occupies)
              </p>
              <p className="text-2xl font-extrabold tracking-tight tabular mt-1">
                {slotMinutes} min
              </p>
              <p className="text-xs font-medium text-muted-foreground mt-1">
                Prep + Service + Cleanup. Used for resource booking conflict checks.
              </p>
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Pricing Model</Label>
              <Select
                value={pricingModel}
                onValueChange={(v) => v && setPricingModel(v as ServiceItemRecord['pricing_model'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_session">Per Session</SelectItem>
                  <SelectItem value="membership_unlimited">Membership Unlimited (future)</SelectItem>
                  <SelectItem value="membership_quota">Membership Quota (future)</SelectItem>
                  <SelectItem value="subscription">Subscription (future)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 col-span-2">
              <Label className="font-semibold cursor-pointer">Commission Applicable</Label>
              <Switch checked={commissionApplicable} onCheckedChange={setCommissionApplicable} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 col-span-2">
              <Label className="font-semibold cursor-pointer">Tip Applicable</Label>
              <Switch checked={tipApplicable} onCheckedChange={setTipApplicable} />
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
