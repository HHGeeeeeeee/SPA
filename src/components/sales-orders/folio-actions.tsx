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
interface Branch { id: string; code: string }
interface TxCode { id: string; code: string; branch_id: string | null; payment_method_id: string | null; credit_account: string | null; transaction_type: string }
interface BillingDest { id: string; code: string; name: string; tx_code: string | null }
interface Guest { id: string; name: string }

const TIPS_PAYABLE = '20500';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

// Folio-tab action buttons, rendered into the Revenue or Payments card header.
//  - section='revenue'  → Add revenue, Adjust charge (manager-PIN gated)
//  - section='payments' → Add payment, Add refund
// Each dialog posts to a chosen branch's shift and shows the GL transaction code
// it will use (read-only, resolved from branch + method). The money rules live
// server-side; these just collect input.
export function FolioActions({
  orderId,
  section,
  methods,
  storedValueCards,
  dueCents,
  paidCents,
  branches,
  orderBranchId,
  transactionCodes,
  openShifts,
  billingDestinations,
  orderBillingToId,
  guests,
}: {
  orderId: string;
  section: 'revenue' | 'payments';
  methods: Method[];
  storedValueCards: Card[];
  dueCents: number;
  paidCents: number;
  branches: Branch[];
  orderBranchId: string | null;
  transactionCodes: TxCode[];
  openShifts: { branchId: string; label: string }[];
  billingDestinations?: BillingDest[];
  orderBillingToId?: string | null;
  guests?: Guest[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const branchList = branches ?? [];
  const txCodes = transactionCodes ?? [];
  const methodList = methods ?? [];
  const cards = storedValueCards ?? [];
  const billingList = billingDestinations ?? [];
  const guestList = guests ?? [];
  const defaultMethod = methodList.find((m) => m.code?.toLowerCase() === 'cash')?.id ?? methodList[0]?.id ?? '';
  // Default posting branch: the user's only branch if they have exactly one,
  // otherwise the order's branch. Always editable.
  const defaultBranch = branchList.length === 1 ? branchList[0].id : (orderBranchId ?? branchList[0]?.id ?? '');
  // AR (掛帳): default Bill to from the order header, guest auto-picked when sole.
  const defaultBill = orderBillingToId ?? billingList[0]?.id ?? '';
  const defaultGuest = guestList.length === 1 ? guestList[0].id : '';

  const methodOptions = methodList.map((m) => ({ value: m.id, label: m.display_name }));
  const branchOptions = branchList.map((b) => ({ value: b.id, label: b.code }));
  const billOptions = billingList.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }));
  const guestOptions = guestList.map((g) => ({ value: g.id, label: g.name }));
  const cardOptions = cards.map((c) => ({ value: c.id, label: `${c.card_no}${c.customer_name ? ` · ${c.customer_name}` : ''} (${peso(c.balance_cents)})` }));
  const codeOf = (id: string) => methodList.find((m) => m.id === id)?.code;
  // AR rides the bill_to destination's bound code; the read-only field shows it.
  const isArMethod = (id: string) => codeOf(id)?.toLowerCase() === 'ar';
  const arDestCode = (billId: string) => billingList.find((b) => b.id === billId)?.tx_code ?? null;

  // The payment-side code shown read-only: the branch's active payment code for
  // the method that isn't the tip code. Mirrors the server resolver, so the
  // displayed code is exactly what gets posted ('—' when none is configured).
  const paymentCodeFor = (branchId: string, methodId: string) =>
    txCodes.find((t) => t.transaction_type === 'payment' && t.branch_id === branchId && t.payment_method_id === methodId && t.credit_account !== TIPS_PAYABLE)?.code ?? null;
  // Revenue is branchless — one service-revenue code rides every manual revenue line.
  const revenueCode = txCodes.find((t) => t.transaction_type === 'revenue')?.code ?? null;
  // The branch's current open cash shift — every posting lands in it. No open
  // shift → the post is blocked (the dialog hints to open one).
  const openShiftFor = (branchId: string) => (openShifts ?? []).find((s) => s.branchId === branchId)?.label ?? null;

  // ── Add payment ──────────────────────────────────────────────────────────
  const [collectOpen, setCollectOpen] = useState(false);
  const [cBranch, setCBranch] = useState(defaultBranch);
  const [cAmount, setCAmount] = useState('');
  const [cMethod, setCMethod] = useState(defaultMethod);
  const [cRef, setCRef] = useState('');
  const [cCard, setCCard] = useState('');
  const [cBill, setCBill] = useState(defaultBill);
  const [cGuest, setCGuest] = useState(defaultGuest);
  const cIsSvc = codeOf(cMethod) === 'stored_value_card';
  const cIsAr = isArMethod(cMethod);
  const cOver = Math.round((Number(cAmount) || 0) * 100) > dueCents;
  function doCollect() {
    const amt = Number(cAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    if (cOver) return toast.error(`Cannot exceed the outstanding (${peso(dueCents)})`);
    if (cIsSvc && !cCard) return toast.error('Select a stored value card');
    if (cIsAr && !cBill) return toast.error('Pick a Bill to');
    if (cIsAr && !cGuest) return toast.error('Pick the guest');
    start(async () => {
      const r = await takePayment({ order_id: orderId, branch_id: cBranch || null, payment_method_id: cMethod, amount: amt, payment_ref: cRef || null, stored_value_card_id: cIsSvc ? cCard : null, billing_destination_id: cIsAr ? cBill : null, order_customer_id: cIsAr ? cGuest : null });
      if (r.ok) { toast.success('Payment recorded'); setCollectOpen(false); setCAmount(''); setCRef(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // ── Add refund ───────────────────────────────────────────────────────────
  const [refundOpen, setRefundOpen] = useState(false);
  const [rBranch, setRBranch] = useState(defaultBranch);
  const [rAmount, setRAmount] = useState('');
  const [rMethod, setRMethod] = useState(defaultMethod);
  const [rRef, setRRef] = useState('');
  const [rCard, setRCard] = useState('');
  const [rBill, setRBill] = useState(defaultBill);
  const [rGuest, setRGuest] = useState(defaultGuest);
  const rIsSvc = codeOf(rMethod) === 'stored_value_card';
  const rIsAr = isArMethod(rMethod);
  const rOver = Math.round((Number(rAmount) || 0) * 100) > paidCents;
  function doRefund() {
    const amt = Number(rAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    if (rOver) return toast.error(`Refund cannot exceed collected (${peso(paidCents)})`);
    if (rIsSvc && !rCard) return toast.error('Select a stored value card');
    if (rIsAr && !rBill) return toast.error('Pick a Bill to');
    if (rIsAr && !rGuest) return toast.error('Pick the guest');
    start(async () => {
      const r = await recordRefund({ order_id: orderId, branch_id: rBranch || null, payment_method_id: rMethod, amount: amt, payment_ref: rRef || null, stored_value_card_id: rIsSvc ? rCard : null, billing_destination_id: rIsAr ? rBill : null, order_customer_id: rIsAr ? rGuest : null });
      if (r.ok) { toast.success('Refund recorded'); setRefundOpen(false); setRAmount(''); setRRef(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // ── Add revenue ──────────────────────────────────────────────────────────
  const [revOpen, setRevOpen] = useState(false);
  const [revBranch, setRevBranch] = useState(defaultBranch);
  const [revAmount, setRevAmount] = useState('');
  const [revNote, setRevNote] = useState('');
  function doAddRevenue() {
    const amt = Number(revAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    start(async () => {
      const r = await addRevenue({ order_id: orderId, branch_id: revBranch || null, amount: amt, note: revNote || null });
      if (r.ok) { toast.success('Revenue posted'); setRevOpen(false); setRevAmount(''); setRevNote(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // ── Adjust charge (manager PIN) ──────────────────────────────────────────
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjBranch, setAdjBranch] = useState(defaultBranch);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjPin, setAdjPin] = useState('');
  function doAdjust() {
    const amt = Number(adjAmount || 0);
    if (amt <= 0) return toast.error('Enter an amount');
    if (adjNote.trim().length < 3) return toast.error('Enter a reason');
    if (!/^\d{4,6}$/.test(adjPin)) return toast.error('Enter the manager PIN');
    start(async () => {
      const r = await adjustCharge({ order_id: orderId, branch_id: adjBranch || null, amount: amt, note: adjNote, manager_pin: adjPin });
      if (r.ok) { toast.success('Charge adjusted'); setAdjOpen(false); setAdjAmount(''); setAdjNote(''); setAdjPin(''); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Reusable Branch picker cell.
  const branchField = (value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold">Branch</Label>
      <Select items={branchOptions} value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  // Bill to (billing destination) — shown only for an AR charge. Drives the code.
  const billField = (value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold">Bill to</Label>
      <Select items={billOptions} value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger><SelectValue placeholder="Pick a destination" /></SelectTrigger>
        <SelectContent>{billOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  // Guest — required for AR so the statement can show a name.
  const guestField = (value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold">Guest</Label>
      <Select items={guestOptions} value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger><SelectValue placeholder="Pick a guest" /></SelectTrigger>
        <SelectContent>{guestOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  // Read-only resolved transaction code.
  const txCodeField = (code: string | null) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold">Transaction Code</Label>
      <Input value={code ?? '—'} readOnly disabled className="font-mono" />
    </div>
  );
  // Read-only current open shift for the chosen branch, else a "please open a
  // shift" hint (postings can't land without one).
  const shiftField = (branchId: string) => {
    const label = openShiftFor(branchId);
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs font-semibold">Open shift</Label>
        {label ? (
          <Input value={label} readOnly disabled />
        ) : (
          <p className="rounded-lg border border-amber-500/50 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            No open shift for this branch — please open a shift first.
          </p>
        )}
      </div>
    );
  };

  if (section === 'payments') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Add payment */}
        <Dialog open={collectOpen} onOpenChange={(o) => { setCollectOpen(o); if (o) { setCBranch(defaultBranch); setCAmount(dueCents > 0 ? String(dueCents / 100) : ''); setCMethod(defaultMethod); setCRef(''); setCBill(defaultBill); setCGuest(defaultGuest); } }}>
          <DialogTrigger render={<Button size="sm" variant="outline"><CreditCard className="size-4" /> Add payment</Button>} />
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-bold">Add payment</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                {branchField(cBranch, setCBranch)}
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-semibold">Method</Label>
                  <Select items={methodOptions} value={cMethod} onValueChange={(v) => v && setCMethod(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{methodOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {cIsAr && (
                <div className="grid grid-cols-2 gap-3">
                  {billField(cBill, setCBill)}
                  {guestField(cGuest, setCGuest)}
                </div>
              )}
              {txCodeField(cIsAr ? arDestCode(cBill) : paymentCodeFor(cBranch, cMethod))}
              {shiftField(cBranch)}
              {cIsSvc && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-semibold">Stored value card</Label>
                  <Select items={cardOptions} value={cCard} onValueChange={(v) => v && setCCard(v)}>
                    <SelectTrigger><SelectValue placeholder="Pick a card" /></SelectTrigger>
                    <SelectContent>{cardOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="relative flex flex-col gap-1">
                <Label className="text-xs font-semibold">Amount</Label>
                <Input type="number" min="0" step="0.01" value={cAmount} onChange={(e) => setCAmount(e.target.value)} aria-invalid={cOver} className={cOver ? 'border-destructive' : undefined} />
                {cOver && <span className="text-[11px] font-medium text-destructive">Max {peso(dueCents)}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Reference</Label>
                <Input value={cRef} onChange={(e) => setCRef(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCollectOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="button" onClick={doCollect} disabled={pending || cOver || !openShiftFor(cBranch)}>{pending ? 'Saving…' : 'Record'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add refund */}
        <Dialog open={refundOpen} onOpenChange={(o) => { setRefundOpen(o); if (o) { setRBranch(defaultBranch); setRAmount(''); setRMethod(defaultMethod); setRRef(''); setRBill(defaultBill); setRGuest(defaultGuest); } }}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="text-destructive" disabled={paidCents <= 0}><Undo2 className="size-4" /> Add refund</Button>} />
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-bold">Add refund</DialogTitle>
              <DialogDescription className="font-medium">Collected so far: {peso(paidCents)} (cannot exceed it)</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                {branchField(rBranch, setRBranch)}
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-semibold">Method</Label>
                  <Select items={methodOptions} value={rMethod} onValueChange={(v) => v && setRMethod(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{methodOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {rIsAr && (
                <div className="grid grid-cols-2 gap-3">
                  {billField(rBill, setRBill)}
                  {guestField(rGuest, setRGuest)}
                </div>
              )}
              {txCodeField(rIsAr ? arDestCode(rBill) : paymentCodeFor(rBranch, rMethod))}
              {shiftField(rBranch)}
              {rIsSvc && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-semibold">Refund onto card</Label>
                  <Select items={cardOptions} value={rCard} onValueChange={(v) => v && setRCard(v)}>
                    <SelectTrigger><SelectValue placeholder="Pick a card" /></SelectTrigger>
                    <SelectContent>{cardOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="relative flex flex-col gap-1">
                <Label className="text-xs font-semibold">Amount</Label>
                <Input type="number" min="0" step="0.01" value={rAmount} onChange={(e) => setRAmount(e.target.value)} aria-invalid={rOver} className={rOver ? 'border-destructive' : undefined} />
                {rOver && <span className="text-[11px] font-medium text-destructive">Max {peso(paidCents)}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Reference</Label>
                <Input value={rRef} onChange={(e) => setRRef(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRefundOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={doRefund} disabled={pending || rOver || !openShiftFor(rBranch)}>{pending ? 'Saving…' : 'Refund'}</Button>
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
      <Dialog open={revOpen} onOpenChange={(o) => { setRevOpen(o); if (o) { setRevBranch(defaultBranch); setRevAmount(''); setRevNote(''); } }}>
        <DialogTrigger render={<Button size="sm" variant="outline"><Plus className="size-4" /> Add revenue</Button>} />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Add revenue</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            {branchField(revBranch, setRevBranch)}
            {txCodeField(revenueCode)}
            {shiftField(revBranch)}
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
            <Button type="button" onClick={doAddRevenue} disabled={pending || !openShiftFor(revBranch)}>{pending ? 'Saving…' : 'Post'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust charge — downward correction, manager PIN required */}
      <Dialog open={adjOpen} onOpenChange={(o) => { setAdjOpen(o); if (o) { setAdjBranch(defaultBranch); setAdjAmount(''); setAdjNote(''); setAdjPin(''); } }}>
        <DialogTrigger render={<Button size="sm" variant="outline" className="text-destructive"><TrendingDown className="size-4" /> Adjust charge</Button>} />
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Adjust charge</DialogTitle>
            <DialogDescription className="font-medium">Posts a negative revenue line (the amount is deducted). Manager PIN required.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            {branchField(adjBranch, setAdjBranch)}
            {txCodeField(revenueCode)}
            {shiftField(adjBranch)}
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
            <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={doAdjust} disabled={pending || !openShiftFor(adjBranch)}>{pending ? 'Saving…' : 'Adjust'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}