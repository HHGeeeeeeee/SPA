'use client';

import { useState, useTransition } from 'react';
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
  const [method, setMethod] = useState(defaultMethodId || paymentMethods[0]?.id || '');
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [ref, setRef] = useState('');
  const [tips, setTips] = useState<Record<string, string>>({});
  const [cardId, setCardId] = useState('');

  const payOptions = paymentMethods.map((p) => ({ value: p.id, label: p.display_name }));
  const paymayaId = paymentMethods.find((p) => p.code === 'paymaya')?.id ?? null;
  const svcId = paymentMethods.find((p) => p.code === 'stored_value_card')?.id ?? null;
  const showTips = !!paymayaId && method === paymayaId && tipTargets.length > 0;
  const showCard = !!svcId && method === svcId;
  const cardOptions = storedValueCards.map((c) => ({
    value: c.id,
    label: `${c.card_no}${c.customer_name ? ` · ${c.customer_name}` : ''} · ₱${(c.balance_cents / 100).toLocaleString('en-PH')}`,
  }));

  function record() {
    const amt = Number(amount);
    if (!method) return toast.error('Pick a payment method');
    if (!amt || amt <= 0) return toast.error('Enter an amount');
    if (showCard && !cardId) return toast.error('Select a stored value card');
    const tipRows = showTips
      ? tipTargets
          .map((t) => ({ order_item_id: t.orderItemId, therapist_id: t.therapistId, amount: Number(tips[t.orderItemId] || 0) }))
          .filter((t) => t.amount > 0)
      : [];
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
          <Select items={payOptions} value={method} onValueChange={(v) => v && setMethod(v)} disabled={locked}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {payOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Amount (₱)</Label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Reference</Label>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="auth / ref" className="w-32" />
        </div>
        <Button size="sm" onClick={record} disabled={pending}>Record</Button>
      </div>
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
      {showTips && (
        <div className="mt-1 rounded-md bg-muted/40 p-2 flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Tip (PAYMAYA)</p>
          {tipTargets.map((t) => (
            <div key={t.orderItemId} className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold min-w-0 truncate">
                {t.therapistName} <span className="font-medium text-muted-foreground">· {t.serviceName}</span>
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={tips[t.orderItemId] ?? ''}
                onChange={(e) => setTips((prev) => ({ ...prev, [t.orderItemId]: e.target.value }))}
                placeholder="0.00"
                className="w-24"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
