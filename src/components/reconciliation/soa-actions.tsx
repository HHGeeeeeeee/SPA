'use client';

import { useEffect, useState, useTransition } from 'react';
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
import { settleSOA, voidSOA, unsettleSOA, uploadArProof, loadSettleContext, type SettleContext } from '@/app/(dashboard)/reconciliation/soa/actions';

// Unified settle dialog. A settle IS an ordinary folio payment (same rules as
// the order Add-payment dialog): pick the posting branch + a real payment
// method; the read-only fields show the method's bound transaction code and
// the branch's open shift (the Sales Remittance the line lands in).
function SettleDialog({ id, branchId, outstandingCents, paidCents = 0 }: { id: string; branchId?: string | null; outstandingCents: number; paidCents?: number }) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<SettleContext | null>(null);
  const [branch, setBranch] = useState('');
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState(String(outstandingCents / 100));
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const amountCents = Math.round((Number(amount) || 0) * 100);
  const isRefund = amountCents < 0;
  // Positive is capped by the outstanding; a negative correction is capped by
  // what's been collected so far on this statement.
  const over = isRefund ? -amountCents > paidCents : amountCents > outstandingCents;
  const partial = amountCents > 0 && amountCents < outstandingCents;

  // Fetch methods + branches (with their open shifts) when the dialog opens,
  // and re-arm the amount with the CURRENT outstanding (it shrinks after a
  // partial payment while the component instance survives the refresh).
  useEffect(() => {
    if (!open) return;
    setAmount(String(outstandingCents / 100));
    if (ctx) return;
    let alive = true;
    loadSettleContext().then((c) => {
      if (!alive) return;
      setCtx(c);
      setBranch((prev) => prev || (branchId && c.branches.some((b) => b.id === branchId) ? branchId : c.branches[0]?.id ?? ''));
      setMethodId((prev) => prev || (c.methods.find((m) => m.code === 'cash')?.id ?? c.methods[0]?.id ?? ''));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const branchOptions = (ctx?.branches ?? []).map((b) => ({ value: b.id, label: b.code }));
  const methodOptions = (ctx?.methods ?? []).map((m) => ({ value: m.id, label: m.display_name }));
  const selBranch = ctx?.branches.find((b) => b.id === branch) ?? null;
  const selMethod = ctx?.methods.find((m) => m.id === methodId) ?? null;

  function submit() {
    if (!branch) return toast.error('Pick a branch');
    if (!methodId) return toast.error('Pick a payment method');
    if (amountCents === 0) return toast.error('Enter a non-zero amount');
    if (over) {
      return toast.error(isRefund
        ? `Refund cannot exceed collected (${(paidCents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })})`
        : `Cannot exceed the outstanding (${(outstandingCents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })})`);
    }
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
      const r = await settleSOA({ soa_id: id, payment_method_id: methodId, branch_id: branch, amount: Number(amount), payment_ref: reference || null, proof_file_path: proofPath });
      if (r.ok) { toast.success(isRefund ? 'Refund recorded' : partial ? 'Partial payment recorded' : 'SOA settled'); setOpen(false); router.refresh(); }
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
            Outstanding: {(outstandingCents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })} — posts an ordinary payment line into the chosen branch&apos;s open shift.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Branch</Label>
            <Select items={branchOptions} value={branch} onValueChange={(v) => v && setBranch(v)}>
              <SelectTrigger><SelectValue placeholder={ctx ? undefined : 'Loading…'} /></SelectTrigger>
              <SelectContent>
                {branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Method</Label>
            <Select items={methodOptions} value={methodId} onValueChange={(v) => v && setMethodId(v)}>
              <SelectTrigger><SelectValue placeholder={ctx ? undefined : 'Loading…'} /></SelectTrigger>
              <SelectContent>
                {methodOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Transaction Code</Label>
            <Input value={selMethod?.tx_code ?? '—'} readOnly disabled className="font-mono" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Open shift</Label>
            {selBranch?.openShift ? (
              <Input value={`${selBranch.openShift.businessDate} · ${selBranch.openShift.label}`} readOnly disabled />
            ) : (
              <p className="rounded-lg border border-amber-500/50 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                No open shift for this branch — open one first.
              </p>
            )}
          </div>
          <div className="relative flex flex-col gap-1">
            <Label className="text-xs font-semibold">Amount</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={over} className={over ? 'border-destructive' : undefined} />
            {over ? (
              <span className="text-[11px] font-medium text-destructive">
                {isRefund
                  ? `Max refund ${(paidCents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })} (collected so far)`
                  : `Max ${(outstandingCents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`}
              </span>
            ) : isRefund ? (
              <span className="text-[11px] font-medium text-destructive">Negative — posts a refund line and adds it back to the outstanding.</span>
            ) : partial ? (
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Partial — the statement stays open as partial-paid.</span>
            ) : null}
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
          {selMethod?.code === 'cash' && (
            <p className="col-span-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Cash is counted into the branch&apos;s shift cash count.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !ctx || !selBranch?.openShift || over || amountCents === 0}
            className={isRefund ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
          >
            {pending ? 'Saving…' : isRefund ? 'Refund' : partial ? 'Record payment' : 'Settle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SoaActions({
  id,
  status,
  branchId,
  outstandingCents,
  paidCents = 0,
  collect = true,
  allowVoid = true,
}: {
  id: string;
  status: string;
  settlementType?: string | null; // accepted for call-site compatibility; unused now
  branchId?: string | null; // the statement's branch — default posting branch for Settle
  outstandingCents: number;
  paidCents?: number; // collected so far — caps a negative (refund) correction
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
        {collect && <SettleDialog id={id} branchId={branchId} outstandingCents={outstandingCents} paidCents={paidCents} />}
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
