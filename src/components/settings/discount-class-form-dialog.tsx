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
  createDiscountClass,
  updateDiscountClass,
} from '@/app/(dashboard)/settings/discount-classes/actions';

interface DiscountItem {
  id: string;
  code: string;
  description: string;
  discount_percent: number;
  discount_amount_cents: number;
  requires_approval: boolean;
  force_apply: boolean;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: DiscountItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DiscountClassFormDialog({
  mode = 'create',
  item,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [code, setCode] = useState(item?.code ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const initialType = item && item.discount_amount_cents > 0 ? 'amount' : 'percent';
  const [type, setType] = useState<'percent' | 'amount'>(initialType);
  const [percent, setPercent] = useState(item ? String(item.discount_percent) : '');
  const [amountPHP, setAmountPHP] = useState(
    item ? String(item.discount_amount_cents / 100) : '',
  );
  const [requiresApproval, setRequiresApproval] = useState(item?.requires_approval ?? false);
  const [forceApply, setForceApply] = useState(item?.force_apply ?? false);
  const [pending, startTransition] = useTransition();

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const dp = type === 'percent' ? Number(percent || 0) : 0;
    const da = type === 'amount' ? Math.round(Number(amountPHP || 0) * 100) : 0;
    startTransition(async () => {
      const result = isEdit
        ? await updateDiscountClass({
            id: item!.id,
            description,
            discount_percent: dp,
            discount_amount_cents: da,
            requires_approval: requiresApproval,
            force_apply: forceApply,
          })
        : await createDiscountClass({
            code,
            description,
            discount_percent: dp,
            discount_amount_cents: da,
            requires_approval: requiresApproval,
            force_apply: forceApply,
          });
      if (result.ok) {
        toast.success(isEdit ? 'Discount class updated' : 'Discount class created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setDescription('');
          setPercent('');
          setAmountPHP('');
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Discount: ${item?.code}` : 'New Discount Class'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Code is immutable. Changes apply to future OrderItems only.'
                : 'Define a new discount type. Code is permanent once created.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dc-code" className="font-semibold">
                Code *
              </Label>
              <Input
                id="dc-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="DIS-XX"
                disabled={isEdit}
                required
                maxLength={20}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="dc-desc" className="font-semibold">
                Description *
              </Label>
              <Input
                id="dc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Discount Type</Label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex items-center gap-2 cursor-pointer rounded-lg border-2 px-3 py-2 transition-colors ${
                    type === 'percent' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={type === 'percent'}
                    onChange={() => setType('percent')}
                  />
                  <span className="text-sm font-bold">Percentage</span>
                </label>
                <label
                  className={`flex items-center gap-2 cursor-pointer rounded-lg border-2 px-3 py-2 transition-colors ${
                    type === 'amount' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={type === 'amount'}
                    onChange={() => setType('amount')}
                  />
                  <span className="text-sm font-bold">Fixed Amount</span>
                </label>
              </div>

              {type === 'percent' ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    placeholder="10"
                  />
                  <span className="font-bold text-muted-foreground">%</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-bold text-muted-foreground">₱</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amountPHP}
                    onChange={(e) => setAmountPHP(e.target.value)}
                    placeholder="200"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label className="font-semibold cursor-pointer">Requires Approval</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  Manager PIN needed at runtime
                </p>
              </div>
              <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label className="font-semibold cursor-pointer">Force Apply</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  OTA-style forced discount; cannot be overridden
                </p>
              </div>
              <Switch checked={forceApply} onCheckedChange={setForceApply} />
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
