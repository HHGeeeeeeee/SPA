'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { cn } from '@/lib/utils';
import { takePayment } from '@/app/(dashboard)/sales-orders/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export interface TipTarget {
  orderItemId: string;
  therapistId: string;
  therapistName: string;
  serviceName: string;
}

interface StoredValueCard { id: string; card_no: string; balance_cents: number; customer_name: string | null }

interface Props {
  orderId: string;
  orderCustomerId: string | null;
  label: string;
  dueCents: number;
  tipTargets: TipTarget[];
  paymentMethods: { id: string; code: string; display_name: string }[];
  storedValueCards: StoredValueCard[];
  locked: boolean;
  defaultMethodId: string;
}

export function CustomerPaymentCard({
  orderId,
  orderCustomerId,
  label,
  dueCents,
  tipTargets,
  paymentMethods,
  storedValueCards,
  locked,
  defaultMethodId,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [method, setMethod] = useState(defaultMethodId || paymentMethods[0]?.id || '');
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [ref, setRef] = useState('');
  const [tips, setTips] = useState<Record<string, string>>({});
  const [cardId, setCardId] = useState('');

  // Switching method clears any tip and resets the amount to the plain due.
  function pickMethod(v: string) {
    setMethod(v);
    setAmount((dueCents / 100).toFixed(2));
    setTips({});
  }
  function setTip(itemId: string, value: string) {
    setTips((prev) => ({ ...prev, [itemId]: value }));
  }

  const payOptions = paymentMethods.map((p) => ({ value: p.id, label: p.display_name }));
  const paymayaId = paymentMethods.find((p) => p.code === 'paymaya')?.id ?? null;
  const svcId = paymentMethods.find((p) => p.code === 'stored_value_card')?.id ?? null;
  const showCard = !!svcId && method === svcId;
  const showTips = ((!!paymayaId && method === paymayaId) || showCard) && tipTargets.length > 0;
  const refRequired = !!paymayaId && method === paymayaId;
  const cardOptions = storedValueCards.map((c) => ({
    value: c.id,
    label: `${c.card_no}${c.customer_name ? ` · ${c.customer_name}` : ''} · ₱${(c.balance_cents / 100).toLocaleString('en-PH')}`,
  }));
  const tipTotalPesos = tipTargets.reduce((s, t) => s + (Number(tips[t.orderItemId]) || 0), 0);
  const amountCents = Math.round((Number(amount) || 0) * 100);
  const tipCents = Math.round(tipTotalPesos * 100);
  const chargeTotalCents = amountCents + tipCents;
  // No over-collection: the bill amount can't exceed this scope's balance due
  // (the server enforces the same). Tips ride on top and don't count here.
  const overDue = amountCents > dueCents;

  function record() {
    const amt = Number(amount);
    if (!method) return toast.error('Pick a payment method');
    if (!amt || amt <= 0) return toast.error('Enter an amount');
    if (overDue) return toast.error(`Cannot exceed the balance due (${peso(dueCents)})`);
    if (showCard && !cardId) return toast.error('Select a stored value card');
    if (refRequired && !ref.trim()) return toast.error('Reference is required for PAYMAYA');
    const tipRows = showTips
      ? tipTargets
          .map((t) => ({ order_item_id: t.orderItemId, therapist_id: t.therapistId, amount: Number(tips[t.orderItemId] || 0) }))
          .filter((t) => t.amount > 0)
      : [];
    // Bill amount pays the order; the tip is recorded separately and charged on
    // top (PAYMAYA total = bill + tip).
    startTransition(async () => {
      const r = await takePayment({
        order_id: orderId,
        order_customer_id: orderCustomerId,
        payment_method_id: method,
        amount: amt,
        payment_ref: ref || null,
        stored_value_card_id: showCard ? cardId : null,
        tips: tipRows,
      });
      if (r.ok) {
        toast.success('Payment recorded');
        router.refresh();
        setRef('');
        setTips({});
        setCardId('');
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">{label}</span>
        <span className="text-sm font-bold tabular">Due {peso(dueCents)}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Method</Label>
          <Select items={payOptions} value={method} onValueChange={(v) => v && pickMethod(v)} disabled={locked}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {payOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex flex-col gap-1">
          <Label className="text-xs font-semibold">Amount (₱)</Label>
          {/* Editable so a bill can be split across methods (e.g. cash part +
              PAYMAYA part). Defaults to the full due; tips stay separate.
              Can't exceed the due — over-collection is blocked. */}
          <Input
            type="number"
            min="0"
            max={(dueCents / 100).toFixed(2)}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={overDue}
            className={cn('w-28 text-right', overDue && 'border-destructive')}
          />
          {/* Floats below the field so the warning never reflows the row. */}
          {overDue && <span className="absolute top-full left-0 mt-0.5 whitespace-nowrap text-[11px] font-medium text-destructive">Max {peso(dueCents)}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Reference {refRequired && <span className="text-destructive">*</span>}</Label>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="auth / ref" className="w-32" />
        </div>
        <Button size="sm" onClick={record} disabled={pending || overDue}>Record</Button>
        {showTips && (
          <div className="ml-auto flex flex-col gap-1">
            <Label className="text-xs font-semibold text-muted-foreground">Tip (PAYMAYA)</Label>
            {tipTargets.map((t) => (
              <div key={t.orderItemId} className="flex items-center gap-2">
                <span className="text-xs font-semibold whitespace-nowrap">
                  {t.therapistName} <span className="font-medium text-muted-foreground">· {t.serviceName}</span>
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tips[t.orderItemId] ?? ''}
                  onChange={(e) => setTip(t.orderItemId, e.target.value)}
                  placeholder="0.00"
                  className="w-24 text-right"
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {showTips && (
        <p className="text-sm font-bold tabular text-right border-t border-border/60 pt-1.5">
          {showCard ? (
            <>
              Card {peso(amountCents)}
              {tipCents > 0 && <span className="text-primary"> · PAYMAYA {peso(tipCents)}</span>}
            </>
          ) : (
            <>PAYMAYA {peso(chargeTotalCents)}</>
          )}
        </p>
      )}
      {showCard && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Stored value card</Label>
          {cardOptions.length === 0 ? (
            <p className="text-xs font-medium text-muted-foreground">No active cards with a balance.</p>
          ) : (
            <Select items={cardOptions} value={cardId} onValueChange={(v) => v && setCardId(v)}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select a card" /></SelectTrigger>
              <SelectContent>
                {cardOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      {locked && <p className="text-[11px] font-medium text-muted-foreground">Intercompany — AR only</p>}
    </div>
  );
}
