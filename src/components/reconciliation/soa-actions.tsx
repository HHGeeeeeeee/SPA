'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { settleSOA, voidSOA, recordSoaPayment, uploadArProof } from '@/app/(dashboard)/reconciliation/soa/actions';

function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Collection methods. Each maps to a branch transaction_code (settle): cash →
// DR 10108, bank → DR 10111, both CR 10200 AR. 'cash' is special — it physically
// enters the front-desk till, so it's counted into today's shift cash count (and
// dated today); a bank deposit is back-office (no till impact).
const METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank deposit' },
];

// Third-party: record a (possibly partial) payment against the statement.
function RecordPaymentDialog({ id, outstandingCents }: { id: string; outstandingCents: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(outstandingCents / 100));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayISO());
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  // Cash drops into today's till → its date is fixed to today and it feeds the
  // shift cash count. The server stamps the real time of entry.
  const isCash = method === 'cash';

  // Upload the proof, then record + post. The proof is required — it's the
  // evidence for the collection (cash photo / bank remittance slip).
  function submit() {
    if (!file) { toast.error(isCash ? 'Attach a cash photo' : 'Attach the remittance slip'); return; }
    start(async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('soa_id', id);
      const up = await uploadArProof(fd);
      if (!up.ok) { toast.error(up.error); return; }
      const r = await recordSoaPayment({
        soa_id: id,
        amount: Number(amount),
        payment_method: method || null,
        reference_no: reference || null,
        paid_at: isCash ? todayISO() : date,
        proof_file_path: up.data?.path ?? null,
      });
      if (r.ok) { toast.success('Payment recorded & posted'); setOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Record Payment</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-bold">Record Payment</DialogTitle>
          <DialogDescription className="font-medium">
            Outstanding: ₱{(outstandingCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Amount (₱)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Method</Label>
            <Select items={METHOD_OPTIONS} value={method} onValueChange={(v) => v && setMethod(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Date received</Label>
            {/* max=today — bank remittances are dated when money landed, never in the future. */}
            <Input
              type="date"
              value={isCash ? todayISO() : date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              disabled={isCash}
            />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <Label className="text-xs font-semibold">Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Txn / slip no." />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <Label className="text-xs font-semibold">
              {isCash ? 'Cash photo' : 'Remittance slip'} <span className="text-destructive">*</span>
            </Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="text-[11px] font-medium text-muted-foreground">Required — attached as proof of collection. Image or PDF, max 10 MB.</span>
          </div>
          {isCash && (
            <p className="col-span-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Cash is counted into today&apos;s shift cash count.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending || !amount || !file}>{pending ? 'Saving…' : 'Confirm & post'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SoaActions({
  id,
  status,
  settlementType,
  outstandingCents,
  collect = true,
  allowVoid = true,
}: {
  id: string;
  status: string;
  settlementType: string | null;
  outstandingCents: number;
  collect?: boolean; // show Settle / Record Payment (collection lives in AR Balance)
  allowVoid?: boolean; // show Void (statement management lives in SOA History)
}) {
  const [pending, startTransition] = useTransition();
  const [voidOpen, setVoidOpen] = useState(false);
  const router = useRouter();
  // Refresh so the OTHER views on this page (AR Balance, Generate SOA) and the
  // history list pick up the result — server actions revalidate the cache but
  // a programmatic call from a client component needs router.refresh() to push
  // the new server-rendered props down.
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); }
      else toast.error(r.error ?? 'Failed');
    });

  // settled / void are terminal — no actions.
  if (status === 'settled' || status === 'void') return null;
  if (!collect && !allowVoid) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {collect && (settlementType === 'intercompany' ? (
          // Intercompany: one-click settle = transfer to cost (no cash).
          <Button size="sm" onClick={() => run(() => settleSOA(id), 'SOA settled')} disabled={pending}>Settle</Button>
        ) : (
          // Third-party: collect money via recorded payments.
          <RecordPaymentDialog id={id} outstandingCents={outstandingCents} />
        ))}
        {allowVoid && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)} disabled={pending}>Void</Button>
        )}
      </div>
      <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this statement?</AlertDialogTitle>
            <AlertDialogDescription>
              The SOA is voided and its covered orders are released back to the Generate pool. Only an unsettled, unpaid statement can be plain-voided — settled or partly-paid statements need a reversal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { run(() => voidSOA(id), 'SOA voided'); setVoidOpen(false); }}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Void
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
