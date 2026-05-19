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
  debit_account: string | null;
  debit_subaccount: string | null;
  debit_branch: string | null;
  credit_account: string | null;
  credit_subaccount: string | null;
  credit_branch: string | null;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: PaymentMethodItem;
  trigger: React.ReactNode;
}

export function PaymentMethodFormDialog({ mode = 'create', item, trigger }: Props) {
  const [open, setOpen] = useState(false);
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
  const [debitAccount, setDebitAccount] = useState(item?.debit_account ?? '');
  const [debitSubaccount, setDebitSubaccount] = useState(item?.debit_subaccount ?? '');
  const [debitBranch, setDebitBranch] = useState(item?.debit_branch ?? '');
  const [creditAccount, setCreditAccount] = useState(item?.credit_account ?? '');
  const [creditSubaccount, setCreditSubaccount] = useState(item?.credit_subaccount ?? '');
  const [creditBranch, setCreditBranch] = useState(item?.credit_branch ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      display_name: displayName,
      currency,
      method_type: methodType,
      manual_reconciliation: manualReconciliation,
      requires_reference: requiresReference,
      debit_account: debitAccount,
      debit_subaccount: debitSubaccount,
      debit_branch: debitBranch,
      credit_account: creditAccount,
      credit_subaccount: creditSubaccount,
      credit_branch: creditBranch,
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
      <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Method: ${item?.code}` : 'New Payment Method'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Configure how customers can pay + the ERP GL accounts each method posts to.
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

            <div className="col-span-2 mt-2">
              <h4 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">
                ERP GL Accounts (Acumatica)
              </h4>
              <p className="text-xs font-medium text-muted-foreground mt-1">
                Used when posting Revenue Confirm to Acumatica. Subaccount cannot contain dashes.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-da" className="font-semibold">Debit · Account</Label>
              <Input
                id="pm-da"
                value={debitAccount ?? ''}
                onChange={(e) => setDebitAccount(e.target.value)}
                placeholder="10108"
                maxLength={20}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-ds" className="font-semibold">Debit · Subaccount</Label>
              <Input
                id="pm-ds"
                value={debitSubaccount ?? ''}
                onChange={(e) => setDebitSubaccount(e.target.value)}
                placeholder="000000000"
                maxLength={20}
                pattern="[^-]*"
              />
            </div>
            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="pm-db" className="font-semibold">Debit · Branch (optional)</Label>
              <Input
                id="pm-db"
                value={debitBranch ?? ''}
                onChange={(e) => setDebitBranch(e.target.value)}
                placeholder="OSP2 (leave blank to use env default)"
                maxLength={20}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-ca" className="font-semibold">Credit · Account</Label>
              <Input
                id="pm-ca"
                value={creditAccount ?? ''}
                onChange={(e) => setCreditAccount(e.target.value)}
                placeholder="40140"
                maxLength={20}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pm-cs" className="font-semibold">Credit · Subaccount</Label>
              <Input
                id="pm-cs"
                value={creditSubaccount ?? ''}
                onChange={(e) => setCreditSubaccount(e.target.value)}
                placeholder="000000000"
                maxLength={20}
                pattern="[^-]*"
              />
            </div>
            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="pm-cb" className="font-semibold">Credit · Branch (optional)</Label>
              <Input
                id="pm-cb"
                value={creditBranch ?? ''}
                onChange={(e) => setCreditBranch(e.target.value)}
                placeholder="OSP2"
                maxLength={20}
              />
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
