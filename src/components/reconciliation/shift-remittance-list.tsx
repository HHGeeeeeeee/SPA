'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  openShift,
  type ShiftListItem,
} from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

function peso(cents: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

interface Props {
  items: ShiftListItem[];
  branches: { id: string; code: string; name: string }[];
  shiftOptions: { branchId: string; labels: string[] }[];
  today: string;
}

export function ShiftRemittanceList({ items, branches, shiftOptions, today }: Props) {
  const router = useRouter();

  // ── Open-shift dialog ─────────────────────────────────────────────────────
  const [openDlg, setOpenDlg] = useState(false);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [pending, start] = useTransition();

  const labelsByBranch = useMemo(
    () => new Map(shiftOptions.map((o) => [o.branchId, o.labels])),
    [shiftOptions],
  );
  // Labels still openable today for the chosen branch = configured minus any
  // already opened/closed today.
  const availableLabels = useMemo(() => {
    const taken = new Set(items.filter((i) => i.branchId === branchId && i.businessDate === today).map((i) => i.label));
    return (labelsByBranch.get(branchId) ?? []).filter((l) => !taken.has(l));
  }, [items, branchId, today, labelsByBranch]);

  function openDialog() {
    const first = branches[0]?.id ?? '';
    setBranchId(first);
    setLabel('');
    setOpenDlg(true);
  }
  function doOpen() {
    if (!branchId || !label) return toast.error('Pick a branch and shift');
    start(async () => {
      const r = await openShift({ branch_id: branchId, date: today, label });
      if (r.ok) {
        toast.success(`${label} opened`);
        // Surface the stranded-service sweep that runs on the day's first open.
        if (r.sweep && r.sweep.recovered.length > 0) {
          toast.success(`Auto-recovered ${r.sweep.recovered.length} unfinished service${r.sweep.recovered.length === 1 ? '' : 's'} from a prior day`);
        }
        if (r.sweep && r.sweep.needsAttention.length > 0) {
          const nos = [...new Set(r.sweep.needsAttention.map((l) => l.orderNo))].join(', ');
          toast.warning(`${r.sweep.needsAttention.length} unfinished service${r.sweep.needsAttention.length === 1 ? '' : 's'} couldn’t be auto-recovered (no price set) — handle manually: ${nos}`, { duration: 10000 });
        }
        setOpenDlg(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {items.length} shift{items.length === 1 ? '' : 's'}
        </p>
        <Button size="sm" onClick={openDialog}>
          <Plus className="size-4" /> Open shift
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Cash</TableHead>
              <TableHead className="text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm font-medium text-muted-foreground">
                  No shifts yet. Click “Open shift” to start one.
                </TableCell>
              </TableRow>
            ) : (
              items.map((it) => (
                <TableRow
                  key={it.id}
                  onClick={() => router.push(`/reconciliation/shift-remittance/${it.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-bold">{it.branchCode}</TableCell>
                  <TableCell className="tabular-nums">{it.businessDate}</TableCell>
                  <TableCell className="font-semibold">{it.label}</TableCell>
                  <TableCell className="text-muted-foreground">{it.openedByName ?? '—'}</TableCell>
                  <TableCell>
                    {it.status === 'open'
                      ? <Badge variant="outline" className="border-primary/50 font-bold text-primary">Open</Badge>
                      : <Badge className="font-bold">Closed</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{peso(it.revenueCents)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{peso(it.cashCents)}</TableCell>
                  <TableCell className="text-right">
                    {it.status === 'closed'
                      ? <span className={`font-bold tabular-nums ${(it.varianceCents ?? 0) === 0 ? 'text-primary' : 'text-destructive'}`}>{peso(it.varianceCents)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Open shift: pick branch + shift, opens for today. */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Open a shift</DialogTitle>
            <DialogDescription className="font-medium">
              Opens for today ({today}). Every sale and payment lands in it until you close it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            {branches.length > 1 && (
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Branch</Label>
                <Select items={branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))} value={branchId} onValueChange={(v) => { if (v) { setBranchId(v); setLabel(''); } }}>
                  <SelectTrigger><SelectValue placeholder="Pick a branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Shift</Label>
              {availableLabels.length === 0 ? (
                <p className="text-sm font-medium text-muted-foreground">Every configured shift is already open or closed today for this branch.</p>
              ) : (
                <Select items={availableLabels.map((l) => ({ value: l, label: l }))} value={label} onValueChange={(v) => v && setLabel(v)}>
                  <SelectTrigger><SelectValue placeholder="Pick a shift" /></SelectTrigger>
                  <SelectContent>
                    {availableLabels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpenDlg(false)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={doOpen} disabled={pending || !branchId || !label}>
              {pending ? 'Opening…' : 'Open shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
