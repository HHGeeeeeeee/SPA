'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CreditCard, Undo2, Plus, TrendingDown } from 'lucide-react';

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
import { takePayment, recordRefund, addRevenue, adjustCharge } from '@/app/(dashboard)/sales-orders/actions';

interface Method { id: string; code: string; display_name: string }
interface Card { id: string; card_no: string; balance_cents: number; customer_name: string | null }

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

// Folio-tab action buttons, rendered into the Revenue or Payments card header.
//  - section='revenue'  → Add revenue, Adjust charge (manager-PIN gated)
//  - section='payments' → Add payment, Add refund
// The money rules live server-side; these just collect input and post.
export function FolioActions({
  orderId,
  section,
  methods,
  storedValueCards,
  dueCents,
  paidCents,
}: {
  orderId: string;
  section: 'revenue' | 'payments';
  methods: Method[];
  storedValueCards: Card[];
  dueCents: number;
  paidCents: number;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const defaultMethod = methods.find((m) => m.code?.toLowerCase() === 'cash')?.id ?? methods[0]?.id ?? '';

  const methodOptions = methods.map((m) => ({ value: m.id, label: m.display_name }));
  const cardOptions = storedValueCards.map((c) => ({ value: c.id, label: `${c.card_no}${c.customer_name ? ` · ${c.customer_name}` : ''} (${peso(c.balance_cents)})` }));
  const codeOf = (id: string) => methods.find((m) => m.id === id)?.code;

  // ── Add payment ──────────────────────────────────────────────────────────
  const [collectOpen, setCollectOpen] = useState(false);
  const [cAmount, setCAmount] = useState('');
  const [cMethod, setCMethod] = useState(defaultMethod);
  const [cRef, setCRef] = useState('');
  const [cCard, setCCard] = useState('');
  const cIsSvc = codeOf(cMethod) === 'stored_value_card';
  const cOver = Math.round((Number(cAmount) || 0) * 100) > dueCents;
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

  // ── Add refund ───────────────────────────────────────────────────────────
  const [refundOpen, setRefundOpen] = useState(false);
  const [rAmount, setRAmount] = useState('');
  const [rMethod, setRMethod] = useState(defaultMethod);
  const [rRef, setRRef] = useState('');
  const [rCard, setRCard] = useState('');
  const rIsSvc = codeOf(rMethod) === 'stored_value_card';
  const rOver = Math.round((Number(rAmount) || 0) * 100) > paidCents;
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

  // ── Add revenue ──────────────────────────────────────────────────────────
  const [revOpen, setRevOpen] = useState(false);
  const [revAmount, setRevAmount] = useState('');
  const [revNote, setRevNote] = useState('');
  function doAddRevenue() {
    const amt = Number(revAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    start(async () => {
      const r = await addRevenue({ order_id: orderId, amount: amt, note: revNote || null });
      if (r.ok) { toast.success('Revenue posted'); setRevOpen(false); setRevAmount(''); setRevNote(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // ── Adjust charge (manager PIN) ──────────────────────────────────────────
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjPin, setAdjPin] = useState('');
  function doAdjust() {
    const amt = Number(adjAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    if (adjNote.trim().length < 3) return toast.error('Enter a reason');
    if (!/^\d{4,6}$/.test(adjPin)) return toast.error('Enter the manager PIN');
    start(async () => {
      const r = await adjustCharge({ order_id: orderId, amount: amt, note: adjNote, manager_pin: adjPin });
      if (r.ok) { toast.success('Charge adjusted'); setAdjOpen(false); setAdjAmount(''); setAdjNote(''); setAdjPin(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  if (section === 'payments') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Add payment */}
        <Dialog open={collectOpen} onOpenChange={(o) => { setCollectOpen(o); if (o) { setCAmount(dueCents > 0 ? String(dueCents / 100) : ''); setCMethod(defaultMethod); setCRef(''); } }}>
          <DialogTrigger render={<Button size="sm" variant="outline"><CreditCard className="size-4" /> Add payment</Button>} />
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-bold">Add payment</DialogTitle>
              <DialogDescription className="font-medium">Outstanding: {peso(dueCents)} (cannot exceed it)</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="relative flex flex-col gap-1">
                  <Label className="text-xs font-semibold">Amount</Label>
                  <Input type="number" min="0" step="0.01" value={cAmount} onChange={(e) => setCAmount(e.target.value)} aria-invalid={cOver} className={cOver ? 'border-destructive' : undefined} />
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

        {/* Add refund */}
        <Dialog open={refundOpen} onOpenChange={(o) => { setRefundOpen(o); if (o) { setRAmount(''); setRMethod(defaultMethod); setRRef(''); } }}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="text-destructive" disabled={paidCents <= 0}><Undo2 className="size-4" /> Add refund</Button>} />
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-bold">Add refund</DialogTitle>
              <DialogDescription className="font-medium">Collected so far: {peso(paidCents)} (refund cannot exceed it)</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="relative flex flex-col gap-1">
                  <Label className="text-xs font-semibold">Amount</Label>
                  <Input type="number" min="0" step="0.01" value={rAmount} onChange={(e) => setRAmount(e.target.value)} aria-invalid={rOver} className={rOver ? 'border-destructive' : undefined} />
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

  // section === 'revenue'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Add revenue */}
      <Dialog open={revOpen} onOpenChange={(o) => { setRevOpen(o); if (o) { setRevAmount(''); setRevNote(''); } }}>
        <DialogTrigger render={<Button size="sm" variant="outline"><Plus className="size-4" /> Add revenue</Button>} />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Add revenue</DialogTitle>
            <DialogDescription className="font-medium">Posts a revenue line to the folio (current shift).</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Amount</Label>
              <Input type="number" min="0" step="0.01" value={revAmount} onChange={(e) => setRevAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Note</Label>
              <Input value={revNote} onChange={(e) => setRevNote(e.target.value)} placeholder="Optional — what is this for?" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRevOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={doAddRevenue} disabled={pending}>{pending ? 'Saving…' : 'Post'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust charge — downward correction, manager PIN required */}
      <Dialog open={adjOpen} onOpenChange={(o) => { setAdjOpen(o); if (o) { setAdjAmount(''); setAdjNote(''); setAdjPin(''); } }}>
        <DialogTrigger render={<Button size="sm" variant="outline" className="text-destructive"><TrendingDown className="size-4" /> Adjust charge</Button>} />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Adjust charge</DialogTitle>
            <DialogDescription className="font-medium">Posts a negative revenue line (the amount is deducted). Manager PIN required.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Amount to deduct</Label>
              <Input type="number" min="0" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="Positive amount" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Reason</Label>
              <Input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Required" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Manager PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={adjPin}
                onChange={(e) => setAdjPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAdjOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={doAdjust} disabled={pending}>{pending ? 'Saving…' : 'Adjust'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
