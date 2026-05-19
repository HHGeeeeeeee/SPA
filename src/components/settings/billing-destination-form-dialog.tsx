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
  createBillingDestination,
  updateBillingDestination,
} from '@/app/(dashboard)/settings/billing-destinations/actions';

export interface BillingDestinationItem {
  id: string;
  code: string;
  name: string;
  settlement_type: 'intercompany' | 'third_party';
  intercompany_account: string | null;
  intercompany_sub: string | null;
  default_payment_method_id: string | null;
  credit_terms_days: number;
}

interface PaymentMethodOption {
  id: string;
  code: string;
  display_name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: BillingDestinationItem;
  paymentMethods: PaymentMethodOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function BillingDestinationFormDialog({
  mode = 'create',
  item,
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
  const [name, setName] = useState(item?.name ?? '');
  const [settlementType, setSettlementType] = useState<BillingDestinationItem['settlement_type']>(
    item?.settlement_type ?? 'intercompany',
  );
  const [intercompanyAccount, setIntercompanyAccount] = useState(item?.intercompany_account ?? '50170');
  const [intercompanySub, setIntercompanySub] = useState(item?.intercompany_sub ?? '000000T03');
  const [defaultPaymentMethodId, setDefaultPaymentMethodId] = useState(
    item?.default_payment_method_id ?? NONE,
  );
  const [creditTermsDays, setCreditTermsDays] = useState(String(item?.credit_terms_days ?? 30));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code,
      name,
      settlement_type: settlementType,
      intercompany_account: settlementType === 'intercompany' ? intercompanyAccount : null,
      intercompany_sub: settlementType === 'intercompany' ? intercompanySub : null,
      default_payment_method_id: defaultPaymentMethodId === NONE ? null : defaultPaymentMethodId,
      credit_terms_days: Number(creditTermsDays),
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateBillingDestination({ id: item!.id, ...payload })
        : await createBillingDestination(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Billing destination updated' : 'Billing destination created');
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
        <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Billing: ${item?.code}` : 'New Billing Destination'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Who pays — group company (intercompany journal) or external (real AR收款).
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bd-code" className="font-semibold">Code *</Label>
              <Input
                id="bd-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="HHO / Third-Party"
                disabled={isEdit}
                required
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bd-name" className="font-semibold">Display Name *</Label>
              <Input
                id="bd-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="H Hotel"
                required
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Settlement Type *</Label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex items-start gap-2 cursor-pointer rounded-lg border-2 px-3 py-3 transition-colors ${
                    settlementType === 'intercompany' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={settlementType === 'intercompany'}
                    onChange={() => setSettlementType('intercompany')}
                  />
                  <div>
                    <span className="text-sm font-bold block">Intercompany</span>
                    <span className="text-xs font-medium text-muted-foreground">
                      集團內 — 月底 settle 走過帳，無金流
                    </span>
                  </div>
                </label>
                <label
                  className={`flex items-start gap-2 cursor-pointer rounded-lg border-2 px-3 py-3 transition-colors ${
                    settlementType === 'third_party' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={settlementType === 'third_party'}
                    onChange={() => setSettlementType('third_party')}
                  />
                  <div>
                    <span className="text-sm font-bold block">Third-Party</span>
                    <span className="text-xs font-medium text-muted-foreground">
                      外部公司 — 真實收款（銀行轉帳）
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {settlementType === 'intercompany' && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bd-ia" className="font-semibold">Intercompany Account *</Label>
                  <Input
                    id="bd-ia"
                    value={intercompanyAccount ?? ''}
                    onChange={(e) => setIntercompanyAccount(e.target.value)}
                    placeholder="50170"
                    required
                    maxLength={20}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="bd-is" className="font-semibold">Intercompany Sub *</Label>
                  <Input
                    id="bd-is"
                    value={intercompanySub ?? ''}
                    onChange={(e) => setIntercompanySub(e.target.value)}
                    placeholder="000000T03"
                    required
                    maxLength={20}
                    pattern="[^-]*"
                  />
                </div>
                <p className="col-span-2 text-xs font-medium text-muted-foreground -mt-2">
                  Subaccount cannot contain dashes. Defaults: 50170 / 000000T03.
                </p>
              </>
            )}

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Default Payment Method</Label>
              <Select
                value={defaultPaymentMethodId ?? NONE}
                onValueChange={(v) => setDefaultPaymentMethodId(v ?? NONE)}
              >
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {paymentMethods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bd-ct" className="font-semibold">Credit Terms (days)</Label>
              <Input
                id="bd-ct"
                type="number"
                min="0"
                max="365"
                value={creditTermsDays}
                onChange={(e) => setCreditTermsDays(e.target.value)}
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
