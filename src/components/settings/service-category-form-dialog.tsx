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

import {
  createServiceCategory,
  updateServiceCategory,
} from '@/app/(dashboard)/settings/service-categories/actions';

export interface CategoryItem {
  id: string;
  code: string;
  name: string;
  business_unit: string;
  commission_applicable: boolean;
  tip_applicable: boolean;
  revenue_account: string | null;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: CategoryItem;
  trigger: React.ReactNode;
}

export function ServiceCategoryFormDialog({ mode = 'create', item, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [businessUnit, setBusinessUnit] = useState(item?.business_unit ?? 'spa');
  const [commissionApplicable, setCommissionApplicable] = useState(item?.commission_applicable ?? true);
  const [tipApplicable, setTipApplicable] = useState(item?.tip_applicable ?? true);
  const [revenueAccount, setRevenueAccount] = useState(item?.revenue_account ?? '');
  const [pending, startTransition] = useTransition();

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      name,
      business_unit: businessUnit,
      commission_applicable: commissionApplicable,
      tip_applicable: tipApplicable,
      revenue_account: revenueAccount || null,
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
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
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
              <Label className="font-semibold">Business Unit *</Label>
              <Select value={businessUnit} onValueChange={(v) => v && setBusinessUnit(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spa">SPA</SelectItem>
                  <SelectItem value="gym">Gym (future)</SelectItem>
                  <SelectItem value="shared">Shared</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sc-revenue" className="font-semibold">Revenue Account (optional)</Label>
              <Input
                id="sc-revenue"
                value={revenueAccount ?? ''}
                onChange={(e) => setRevenueAccount(e.target.value)}
                placeholder="40140"
                maxLength={20}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Override ERP revenue account for this category (leave empty to use system default).
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
