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
  createPaymentMethod,
  updatePaymentMethod,
} from '@/app/(dashboard)/settings/payment-methods/actions';

export interface PaymentMethodItem {
  id: string;
  code: string;
  display_name: string;
  currency: string;
  method_type: 'one_time' | 'recurring' | 'stored_value' | 'prepaid_quota';
  manual_reconciliation: boolean;
  requires_reference: boolean;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: PaymentMethodItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PaymentMethodFormDialog({
  mode = 'create',
  item,
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
  const [displayName, setDisplayName] = useState(item?.display_name ?? '');
  const [currency, setCurrency] = useState(item?.currency ?? 'PHP');
  const [methodType, setMethodType] = useState<PaymentMethodItem['method_type']>(
    item?.method_type ?? 'one_time',
  );
  const [manualReconciliation, setManualReconciliation] = useState(
    item?.manual_reconciliation ?? true,
  );
  const [requiresReference, setRequiresReference] = useState(item?.requires_reference ?? false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      display_name: displayName,
      currency,
      method_type: methodType,
      manual_reconciliation: manualReconciliation,
      requires_reference: requiresReference,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updatePaymentMethod({ id: item!.id, ...payload })
        : await createPaymentMethod(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Payment method updated' : 'Payment method created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setDisplayName('');
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
              {isEdit ? `Edit Method: ${item?.code}` : 'New Payment Method'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Configure how customers can pay.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-code" className="font-semibold">Code *</Label>
              <Input
                id="pm-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                placeholder="cash / paymaya / ar"
                disabled={isEdit}
                required
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-name" className="font-semibold">Display Name *</Label>
              <Input
                id="pm-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={80}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Currency *</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PHP">PHP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Method Type *</Label>
              <Select
                value={methodType}
                onValueChange={(v) => v && setMethodType(v as PaymentMethodItem['method_type'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">One-time</SelectItem>
                  <SelectItem value="recurring">Recurring (future)</SelectItem>
                  <SelectItem value="stored_value">Stored Value</SelectItem>
                  <SelectItem value="prepaid_quota">Prepaid Quota (future)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 col-span-2">
              <div>
                <Label className="font-semibold cursor-pointer">Manual Reconciliation</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  Counter must manually verify (cash, AR). Auto methods (PAYMAYA) = unchecked.
                </p>
              </div>
              <Switch checked={manualReconciliation} onCheckedChange={setManualReconciliation} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 col-span-2">
              <div>
                <Label className="font-semibold cursor-pointer">Requires Reference Number</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  PAYMAYA / Bank Transfer must capture a reference / auth code.
                </p>
              </div>
              <Switch checked={requiresReference} onCheckedChange={setRequiresReference} />
            </div>

            <p className="col-span-2 text-xs font-medium text-muted-foreground">
              GL posting accounts are defined per Transaction Code (branch × payment method
              × event), not here.
            </p>
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
