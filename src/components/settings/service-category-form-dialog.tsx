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
  createServiceCategory,
  updateServiceCategory,
} from '@/app/(dashboard)/settings/service-categories/actions';
import { RESOURCE_TYPES } from '@/lib/resource-types';

export interface CategoryItem {
  id: string;
  code: string;
  name: string;
  business_unit_ids: string[];
  commission_applicable: boolean;
  tip_applicable: boolean;
  revenue_account: string | null;
  required_resource_types: string[];
}

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: CategoryItem;
  businessUnits: BusinessUnitOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ServiceCategoryFormDialog({
  mode = 'create',
  item,
  businessUnits,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [unitIds, setUnitIds] = useState<string[]>(item?.business_unit_ids ?? []);
  const [commissionApplicable, setCommissionApplicable] = useState(item?.commission_applicable ?? true);
  const [tipApplicable, setTipApplicable] = useState(item?.tip_applicable ?? true);
  const [revenueAccount, setRevenueAccount] = useState(item?.revenue_account ?? '');
  const [resourceTypes, setResourceTypes] = useState<string[]>(item?.required_resource_types ?? []);
  const [pending, startTransition] = useTransition();

  const isEdit = mode === 'edit';

  function toggleUnit(id: string) {
    setUnitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const toggleResourceType = (value: string) =>
    setResourceTypes((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (unitIds.length === 0) {
      toast.error('Pick at least one business unit');
      return;
    }
    const payload = {
      code,
      name,
      business_unit_ids: unitIds,
      commission_applicable: commissionApplicable,
      tip_applicable: tipApplicable,
      revenue_account: revenueAccount || null,
      required_resource_types: resourceTypes,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateServiceCategory({ id: item!.id, ...payload })
        : await createServiceCategory(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Category updated' : 'Category created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
          setRevenueAccount('');
          setUnitIds([]);
          setResourceTypes([]);
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
              {isEdit ? `Edit Category: ${item?.code}` : 'New Service Category'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Code is immutable. Other fields can be changed.'
                : 'A category groups related services (Massage, Hair, etc.)'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sc-code" className="font-semibold">Code *</Label>
              <Input
                id="sc-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MASSAGE"
                disabled={isEdit}
                required
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sc-name" className="font-semibold">Name *</Label>
              <Input
                id="sc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Applies To Business Units *</Label>
              <div className="flex flex-col gap-1 rounded-lg border border-input p-2">
                {businessUnits.length === 0 ? (
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                    No business units defined. Create one in Settings → Business Units first.
                  </p>
                ) : (
                  businessUnits.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={unitIds.includes(b.id)}
                        onChange={() => toggleUnit(b.id)}
                      />
                      <span className="text-sm font-semibold">{b.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">{b.code}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Pick every business line this category belongs to.
              </p>
            </div>

            {/* Revenue Account hidden for now (ERP posting deferred). State +
                payload kept so existing values are preserved on edit. */}

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Station Types</Label>
              <div className="flex flex-wrap gap-2">
                {RESOURCE_TYPES.map((t) => {
                  const on = resourceTypes.includes(t.value);
                  return (
                    <button
                      type="button"
                      key={t.value}
                      onClick={() => toggleResourceType(t.value)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Which stations this category can use — pick all that apply. Drives
                reservation bed/station capacity checks. Leave all off if it needs no station.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label className="font-semibold cursor-pointer">Commission Applicable</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  Items in this category count toward therapist commission
                </p>
              </div>
              <Switch checked={commissionApplicable} onCheckedChange={setCommissionApplicable} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label className="font-semibold cursor-pointer">Tip Applicable</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  Customers can leave PAYMAYA tip on these items
                </p>
              </div>
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
