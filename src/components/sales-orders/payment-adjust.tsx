'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CreditCard, Undo2 } from 'lucide-react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { takePayment, recordRefund } from '@/app/(dashboard)/sales-orders/actions';

interface Method { id: string; code: string; display_name: string }
interface Card { id: string; card_no: string; balance_cents: number; customer_name: string | null }

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

// Manager-only post-payment corrections on a completed/paid order: collect an
// outstanding balance, or refund money back out. No overpayment — Collect is
// capped at the amount due (server-enforced). Refund can't exceed what was
// collected; a stored-value refund loads back onto the card.
export function PaymentAdjust({
  orderId,
  methods,
  storedValueCards,
  dueCents,
  paidCents,
}: {
  orderId: string;
  methods: Method[];
  storedValueCards: Card[];
  dueCents: number;
  paidCents: number;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const defaultMethod = methods.find((m) => m.code?.toLowerCase() === 'cash')?.id ?? methods[0]?.id ?? '';

  const [collectOpen, setCollectOpen] = useState(false);
  const [cAmount, setCAmount] = useState('');
  const [cMethod, setCMethod] = useState(defaultMethod);
  const [cRef, setCRef] = useState('');
  const [cCard, setCCard] = useState('');

  const [refundOpen, setRefundOpen] = useState(false);
  const [rAmount, setRAmount] = useState('');
  const [rMethod, setRMethod] = useState(defaultMethod);
  const [rRef, setRRef] = useState('');
  const [rCard, setRCard] = useState('');

  const methodOptions = methods.map((m) => ({ value: m.id, label: m.display_name }));
  const cardOptions = storedValueCards.map((c) => ({ value: c.id, label: `${c.card_no}${c.customer_name ? ` · ${c.customer_name}` : ''} (${peso(c.balance_cents)})` }));
  const codeOf = (id: string) => methods.find((m) => m.id === id)?.code;
  const cIsSvc = codeOf(cMethod) === 'stored_value_card';
  const rIsSvc = codeOf(rMethod) === 'stored_value_card';
  // No over-collection / over-refund: Collect can't exceed what's outstanding,
  // Refund can't exceed what's been collected (the server enforces the same).
  const cOver = Math.round((Number(cAmount) || 0) * 100) > dueCents;
  const rOver = Math.round((Number(rAmount) || 0) * 100) > paidCents;

  function doCollect() {
    const amt = Number(cAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    if (cOver) return toast.error(`Cannot exceed the outstanding (${peso(dueCents)})`);
    if (cIsSvc && !cCard) return toast.error('Select a stored value card');
    start(async () => {
      const r = await takePayment({ order_id: orderId, payment_method_id: cMethod, amount: amt, payment_ref: cRef || null, stored_value_card_id: cIsSvc ? cCard : null });
      if (r.ok) { toast.success('Payment recorded'); setCollectOpen(false); setCAmount(''); setCRef(''); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function doRefund() {
    const amt = Number(rAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    if (rOver) return toast.error(`Refund cannot exceed collected (${peso(paidCents)})`);
    if (rIsSvc && !rCard) return toast.error('Select a stored value card');
    start(async () => {
      const r = await recordRefund({ order_id: orderId, payment_method_id: rMethod, amount: amt, payment_ref: rRef || null, stored_value_card_id: rIsSvc ? rCard : null });
      if (r.ok) { toast.success('Refund recorded'); setRefundOpen(false); setRAmount(''); setRRef(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={collectOpen} onOpenChange={(o) => { setCollectOpen(o); if (o) { setCAmount(String(dueCents / 100)); setCMethod(defaultMethod); setCRef(''); } }}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" disabled={dueCents <= 0} title={dueCents <= 0 ? 'Fully paid — refund first to re-collect' : undefined}>
              <CreditCard className="size-4" /> Collect more
            </Button>
          }
        />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Collect payment</DialogTitle>
            <DialogDescription className="font-medium">Outstanding: {peso(dueCents)} (cannot exceed it)</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="relative flex flex-col gap-1">
                <Label className="text-xs font-semibold">Amount</Label>
                <Input type="number" min="0" max={(dueCents / 100).toFixed(2)} step="0.01" value={cAmount} onChange={(e) => setCAmount(e.target.value)} aria-invalid={cOver} className={cOver ? 'border-destructive' : undefined} />
                {cOver && <span className="absolute top-full left-0 mt-0.5 whitespace-nowrap text-[11px] font-medium text-destructive">Max {peso(dueCents)}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Method</Label>
                <Select items={methodOptions} value={cMethod} onValueChange={(v) => v && setCMethod(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{methodOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {cIsSvc && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Stored value card</Label>
                <Select items={cardOptions} value={cCard} onValueChange={(v) => v && setCCard(v)}>
                  <SelectTrigger><SelectValue placeholder="Pick a card" /></SelectTrigger>
                  <SelectContent>{cardOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Reference</Label>
              <Input value={cRef} onChange={(e) => setCRef(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCollectOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={doCollect} disabled={pending || cOver}>{pending ? 'Saving…' : 'Record'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={(o) => { setRefundOpen(o); if (o) { setRAmount(''); setRMethod(defaultMethod); setRRef(''); } }}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" className="text-destructive" disabled={paidCents <= 0}>
              <Undo2 className="size-4" /> Refund
            </Button>
          }
        />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Refund</DialogTitle>
            <DialogDescription className="font-medium">Collected so far: {peso(paidCents)} (refund cannot exceed it)</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="relative flex flex-col gap-1">
                <Label className="text-xs font-semibold">Amount</Label>
                <Input type="number" min="0" max={(paidCents / 100).toFixed(2)} step="0.01" value={rAmount} onChange={(e) => setRAmount(e.target.value)} aria-invalid={rOver} className={rOver ? 'border-destructive' : undefined} />
                {rOver && <span className="absolute top-full left-0 mt-0.5 whitespace-nowrap text-[11px] font-medium text-destructive">Max {peso(paidCents)}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Method</Label>
                <Select items={methodOptions} value={rMethod} onValueChange={(v) => v && setRMethod(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{methodOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {rIsSvc && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Refund onto card</Label>
                <Select items={cardOptions} value={rCard} onValueChange={(v) => v && setRCard(v)}>
                  <SelectTrigger><SelectValue placeholder="Pick a card" /></SelectTrigger>
                  <SelectContent>{cardOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Reference</Label>
              <Input value={rRef} onChange={(e) => setRRef(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRefundOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={doRefund} disabled={pending || rOver}>{pending ? 'Saving…' : 'Refund'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
