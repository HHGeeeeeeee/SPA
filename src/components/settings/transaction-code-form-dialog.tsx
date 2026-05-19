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
  createTransactionCode,
  updateTransactionCode,
} from '@/app/(dashboard)/settings/transaction-codes/actions';

export interface TxCodeItem {
  id: string;
  code: string;
  branch_id: string;
  transaction_type: 'payment' | 'settle' | 'cost' | 'adjust';
  payment_method_id: string | null;
  debit_account: string | null;
  debit_subaccount: string | null;
  debit_branch_id: string | null;
  credit_account: string | null;
  credit_subaccount: string | null;
  credit_branch_id: string | null;
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
}
interface PaymentMethodOption {
  id: string;
  code: string;
  display_name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: TxCodeItem;
  branches: BranchOption[];
  paymentMethods: PaymentMethodOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function TransactionCodeFormDialog({
  mode = 'create',
  item,
  branches,
  paymentMethods,
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
  const [branchId, setBranchId] = useState(item?.branch_id ?? branches[0]?.id ?? '');
  const [txType, setTxType] = useState<TxCodeItem['transaction_type']>(
    item?.transaction_type ?? 'payment',
  );
  const [paymentMethodId, setPaymentMethodId] = useState(item?.payment_method_id ?? NONE);
  const [debitAccount, setDebitAccount] = useState(item?.debit_account ?? '');
  const [debitSubaccount, setDebitSubaccount] = useState(item?.debit_subaccount ?? '');
  const [debitBranchId, setDebitBranchId] = useState(item?.debit_branch_id ?? NONE);
  const [creditAccount, setCreditAccount] = useState(item?.credit_account ?? '');
  const [creditSubaccount, setCreditSubaccount] = useState(item?.credit_subaccount ?? '');
  const [creditBranchId, setCreditBranchId] = useState(item?.credit_branch_id ?? NONE);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      branch_id: branchId,
      transaction_type: txType,
      payment_method_id: paymentMethodId === NONE ? null : paymentMethodId,
      debit_account: debitAccount,
      debit_subaccount: debitSubaccount,
      debit_branch_id: debitBranchId === NONE ? null : debitBranchId,
      credit_account: creditAccount,
      credit_subaccount: creditSubaccount,
      credit_branch_id: creditBranchId === NONE ? null : creditBranchId,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateTransactionCode({ id: item!.id, ...payload })
        : await createTransactionCode(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Tx code updated' : 'Tx code created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setDebitAccount('');
          setDebitSubaccount('');
          setCreditAccount('');
          setCreditSubaccount('');
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Tx Code: ${item?.code}` : 'New Transaction Code'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Drives Acumatica GL postings. Each code = one DR/CR pair.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-4 py-4">
            <div className="flex flex-col gap-2 col-span-3">
              <Label htmlFor="tc-code" className="font-semibold">Code *</Label>
              <Input
                id="tc-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="OSP2-PAYMENT-CASH / OSP2-SETTLE-AR-INTERCOMPANY"
                disabled={isEdit}
                required
                maxLength={60}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch *</Label>
              <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Type *</Label>
              <Select value={txType} onValueChange={(v) => v && setTxType(v as TxCodeItem['transaction_type'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="settle">Settle</SelectItem>
                  <SelectItem value="cost">Cost</SelectItem>
                  <SelectItem value="adjust">Adjust</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Payment Method</Label>
              <Select
                value={paymentMethodId ?? NONE}
                onValueChange={(v) => setPaymentMethodId(v ?? NONE)}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {paymentMethods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-3 mt-2">
              <h4 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">
                Debit (DR) Side
              </h4>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tc-da" className="font-semibold">Account</Label>
              <Input
                id="tc-da"
                value={debitAccount ?? ''}
                onChange={(e) => setDebitAccount(e.target.value)}
                placeholder="10108"
                maxLength={20}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tc-ds" className="font-semibold">Subaccount</Label>
              <Input
                id="tc-ds"
                value={debitSubaccount ?? ''}
                onChange={(e) => setDebitSubaccount(e.target.value)}
                placeholder="000000000"
                maxLength={20}
                pattern="[^-]*"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch (override)</Label>
              <Select
                value={debitBranchId ?? NONE}
                onValueChange={(v) => setDebitBranchId(v ?? NONE)}
              >
                <SelectTrigger><SelectValue placeholder="(use header)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>(use header)</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-3 mt-2">
              <h4 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">
                Credit (CR) Side
              </h4>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tc-ca" className="font-semibold">Account</Label>
              <Input
                id="tc-ca"
                value={creditAccount ?? ''}
                onChange={(e) => setCreditAccount(e.target.value)}
                placeholder="40140"
                maxLength={20}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tc-cs" className="font-semibold">Subaccount</Label>
              <Input
                id="tc-cs"
                value={creditSubaccount ?? ''}
                onChange={(e) => setCreditSubaccount(e.target.value)}
                placeholder="000000000"
                maxLength={20}
                pattern="[^-]*"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch (override)</Label>
              <Select
                value={creditBranchId ?? NONE}
                onValueChange={(v) => setCreditBranchId(v ?? NONE)}
              >
                <SelectTrigger><SelectValue placeholder="(use header)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>(use header)</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
