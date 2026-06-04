'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, Check, Pencil, Trash2, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  loadPriceSchedule,
  scheduleServicePriceChange,
  updateScheduledPrice,
  deleteFuturePrice,
  type PriceSegment,
} from '@/app/(dashboard)/settings/service-items/actions';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const STATUS: Record<PriceSegment['status'], { label: string; cls: string; variant: 'default' | 'secondary' }> = {
  past: { label: 'Ended', cls: '', variant: 'secondary' },
  current: { label: 'Current', cls: '', variant: 'default' },
  future: { label: 'Scheduled', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', variant: 'secondary' },
};

export function PriceScheduleDialog({
  serviceItemId,
  label,
  open,
  onOpenChange,
  trigger,
}: {
  serviceItemId: string;
  label: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [segs, setSegs] = useState<PriceSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, startBusy] = useTransition();
  const [newPrice, setNewPrice] = useState('');
  const [newFrom, setNewFrom] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editFrom, setEditFrom] = useState('');

  async function reload() {
    setLoading(true);
    setSegs(await loadPriceSchedule(serviceItemId));
    setLoading(false);
  }
  useEffect(() => {
    if (isOpen) {
      reload();
      setNewPrice(''); setNewFrom(''); setEditId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function schedule() {
    startBusy(async () => {
      const r = await scheduleServicePriceChange({ service_item_id: serviceItemId, price: Number(newPrice), effective_from: newFrom });
      if (r.ok) { toast.success('Price change scheduled'); setNewPrice(''); setNewFrom(''); await reload(); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function saveEdit(id: string) {
    startBusy(async () => {
      const r = await updateScheduledPrice(id, Number(editPrice), editFrom || undefined);
      if (r.ok) { toast.success('Price updated'); setEditId(null); await reload(); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function remove(id: string) {
    startBusy(async () => {
      const r = await deleteFuturePrice(id);
      if (r.ok) { toast.success('Scheduled change removed'); await reload(); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger as React.ReactElement} /> : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" /> Price schedule — {label}
          </DialogTitle>
          <DialogDescription className="font-medium">
            Effective-dated list price (Normal, all branches). Orders use the price effective on the service date; past prices stay as history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold">From</TableHead>
                  <TableHead className="font-bold">To</TableHead>
                  <TableHead className="w-36 font-bold text-right">Price</TableHead>
                  <TableHead className="w-28 font-bold">Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {segs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm font-semibold text-muted-foreground">
                      {loading ? 'Loading…' : 'No price set.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  segs.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium tabular">
                        {editId === s.id ? (
                          <Input type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} className="h-8 w-40" />
                        ) : s.effective_from}
                      </TableCell>
                      <TableCell className="font-medium tabular text-muted-foreground">{s.open_ended ? 'until changed' : s.effective_to}</TableCell>
                      <TableCell className="font-bold tabular text-right">
                        {editId === s.id ? (
                          <Input type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="h-8 w-28 ml-auto text-right" />
                        ) : peso(s.price_cents)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS[s.status].variant} className={`font-bold ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</Badge>
                      </TableCell>
                      <TableCell>
                        {s.status !== 'past' && (
                          <div className="flex justify-end gap-1">
                            {editId === s.id ? (
                              <>
                                <Button size="icon" variant="ghost" disabled={busy} onClick={() => saveEdit(s.id)}><Check className="size-4" /></Button>
                                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setEditId(null)}><X className="size-4" /></Button>
                              </>
                            ) : (
                              <Button size="icon" variant="ghost" disabled={busy} onClick={() => { setEditId(s.id); setEditPrice(String(s.price_cents / 100)); setEditFrom(s.effective_from); }}><Pencil className="size-4" /></Button>
                            )}
                            <Button size="icon" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(s.id)}><Trash2 className="size-4" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-border p-4 bg-muted/20">
            <p className="text-sm font-bold mb-3">Schedule a price change</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">New price</Label>
                <Input type="number" min="0" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="w-36" placeholder="900" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Effective from</Label>
                <Input type="date" min={todayISO()} value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="w-44" />
              </div>
              <Button onClick={schedule} disabled={busy || !newPrice || !newFrom}>Schedule</Button>
            </div>
            <p className="text-xs font-medium text-muted-foreground mt-2">
              The current price ends the day before; the new price applies from this date onward. Use today’s date for an immediate change.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
