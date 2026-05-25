'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Percent } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { batchScheduleServicePriceChange } from '@/app/(dashboard)/settings/service-items/actions';

export interface BatchTarget {
  id: string;
  label: string;
  currentCents: number | null;
}

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;
}
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function roundPeso(cents: number): number {
  return Math.round(cents / 100) * 100;
}

export function BatchPriceDialog({
  targets,
  open,
  onOpenChange,
  onApplied,
}: {
  targets: BatchTarget[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [magnitude, setMagnitude] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [busy, startBusy] = useTransition();

  const signedValue = (Number(magnitude) || 0) * direction;

  // Preview rows — new price computed with the same rule the server uses
  // (round to ₱1). Skips items with no current price (server reads the open
  // segment authoritatively, so this is a guide).
  const preview = useMemo(() => targets.map((t) => {
    if (t.currentCents == null) return { ...t, newCents: null as number | null, skip: 'no price' };
    const raw = mode === 'percent' ? t.currentCents * (1 + signedValue / 100) : t.currentCents + signedValue * 100;
    const newCents = roundPeso(raw);
    if (newCents <= 0) return { ...t, newCents, skip: '≤ ₱0' };
    return { ...t, newCents, skip: '' };
  }), [targets, mode, signedValue]);

  const changing = preview.filter((p) => !p.skip && p.newCents != null && p.newCents !== p.currentCents).length;

  function apply() {
    if (!magnitude || Number(magnitude) <= 0) return toast.error('Enter an amount');
    startBusy(async () => {
      const r = await batchScheduleServicePriceChange({
        service_item_ids: targets.map((t) => t.id),
        mode,
        value: signedValue,
        effective_from: effectiveFrom,
      });
      if (r.ok) {
        const s = r.data?.skipped ?? [];
        toast.success(`Applied to ${r.data?.applied}${s.length ? ` · ${s.length} skipped` : ''}`);
        onOpenChange(false);
        onApplied?.();
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold flex items-center gap-2">
            <Percent className="size-5 text-primary" /> Batch price change — {targets.length} service{targets.length > 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription className="font-medium">
            Adjust by percentage or a fixed amount, rounded to ₱1. Each service keeps its history; the new price applies from the effective date.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Type</Label>
              <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {(['percent', 'amount'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={cn('rounded-md px-3 py-1.5 text-sm font-bold transition-colors', mode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>
                    {m === 'percent' ? 'Percentage' : 'Fixed ₱'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Direction</Label>
              <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {([[1, 'Increase'], [-1, 'Decrease']] as const).map(([d, lbl]) => (
                  <button key={lbl} type="button" onClick={() => setDirection(d as 1 | -1)}
                    className={cn('rounded-md px-3 py-1.5 text-sm font-bold transition-colors', direction === d ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">{mode === 'percent' ? 'Percent (%)' : 'Amount (₱)'}</Label>
              <Input type="number" min="0" step={mode === 'percent' ? '0.5' : '1'} value={magnitude} onChange={(e) => setMagnitude(e.target.value)} className="w-32" placeholder={mode === 'percent' ? '10' : '100'} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold">Effective from</Label>
              <Input type="date" min={todayISO()} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-44" />
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold">Service</TableHead>
                  <TableHead className="w-28 font-bold text-right">Current</TableHead>
                  <TableHead className="w-28 font-bold text-right">New</TableHead>
                  <TableHead className="w-24 font-bold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((p) => (
                  <TableRow key={p.id} className={p.skip ? 'opacity-60' : ''}>
                    <TableCell className="font-mono font-semibold">{p.label}</TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">{p.currentCents != null ? peso(p.currentCents) : '—'}</TableCell>
                    <TableCell className="tabular text-right font-bold">
                      {p.skip ? '—' : p.newCents != null ? peso(p.newCents) : '—'}
                    </TableCell>
                    <TableCell>
                      {p.skip ? <Badge variant="secondary" className="font-bold">skip · {p.skip}</Badge>
                        : p.newCents === p.currentCents ? <Badge variant="secondary" className="font-bold">no change</Badge>
                        : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            {changing} service{changing === 1 ? '' : 's'} will change. Preview uses each service’s current price; the new segment opens on {effectiveFrom}.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={apply} disabled={busy || changing === 0}>{busy ? 'Applying…' : `Apply to ${changing}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
