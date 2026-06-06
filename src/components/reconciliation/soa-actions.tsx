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
import { settleSOA, voidSOA, unsettleSOA, uploadArProof } from '@/app/(dashboard)/reconciliation/soa/actions';

// Settle methods — each posts a folio settle line into the branch's open shift
// (so it lands in Sales Remittance). Cash drops into today's till; a bank deposit
// is back-office but still recorded against the shift.
const METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank deposit' },
];

// Unified settle dialog: pick a method, optionally attach a proof (cash photo /
// remittance slip), then open the folio settle line. Used for every statement
// type now — there's no separate intercompany one-click vs third-party path.
function SettleDialog({ id, outstandingCents }: { id: string; outstandingCents: number }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    start(async () => {
      let proofPath: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('soa_id', id);
        const up = await uploadArProof(fd);
        if (!up.ok) { toast.error(up.error); return; }
        proofPath = up.data?.path ?? null;
      }
      const r = await settleSOA({ soa_id: id, payment_method: method, proof_file_path: proofPath });
      if (r.ok) { toast.success('SOA settled'); setOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Settle</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-bold">Settle statement</DialogTitle>
          <DialogDescription className="font-medium">
            Outstanding: {(outstandingCents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })} — posts a settle line into the branch&apos;s open shift.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
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
            <Label className="text-xs font-semibold">Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Txn / slip no." />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <Label className="text-xs font-semibold">Proof (optional)</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="text-[11px] font-medium text-muted-foreground">Cash photo / remittance slip. Image or PDF, max 10 MB.</span>
          </div>
          {method === 'cash' && (
            <p className="col-span-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Cash is counted into the branch&apos;s shift cash count.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Settle'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SoaActions({
  id,
  status,
  outstandingCents,
  collect = true,
  allowVoid = true,
}: {
  id: string;
  status: string;
  settlementType?: string | null; // accepted for call-site compatibility; unused now
  outstandingCents: number;
  collect?: boolean; // show Settle (collection lives in AR Balance)
  allowVoid?: boolean; // show Void / Unsettle (statement management lives in SOA History)
}) {
  const [pending, startTransition] = useTransition();
  const [voidOpen, setVoidOpen] = useState(false);
  const [unsettleOpen, setUnsettleOpen] = useState(false);
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); }
      else toast.error(r.error ?? 'Failed');
    });

  if (status === 'void') return null;

  // Settled → the only action is reversing the settle (History only).
  if (status === 'settled') {
    if (!allowVoid) return null;
    return (
      <>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setUnsettleOpen(true)} disabled={pending}>Unsettle</Button>
        <AlertDialog open={unsettleOpen} onOpenChange={setUnsettleOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reverse this settlement?</AlertDialogTitle>
              <AlertDialogDescription>
                Posts a negative settle line into the open shift, clears the settle reference on every line in the statement, and reopens the SOA as issued.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { run(() => unsettleSOA(id), 'Settlement reversed'); setUnsettleOpen(false); }} disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
                Unsettle
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (!collect && !allowVoid) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {collect && <SettleDialog id={id} outstandingCents={outstandingCents} />}
        {allowVoid && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)} disabled={pending}>Void</Button>
        )}
      </div>
      <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this statement?</AlertDialogTitle>
            <AlertDialogDescription>
              The SOA is voided and its AR lines are released back to the Generate pool. Only an issued (unsettled) statement can be voided — unsettle a settled one first.
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
