'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, FileText, FilePlus2, CalendarClock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SoaActions } from '@/components/reconciliation/soa-actions';
import { loadSoaWorkspace, generateSOAForBillings, type SoaGroup } from '@/app/(dashboard)/reconciliation/soa/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', issued: 'default', partial_paid: 'secondary', settled: 'default', void: 'destructive',
};

export interface SoaHistoryRow {
  id: string;
  soa_no: string;
  status: string;
  settlement_type: string | null;
  period_from: string;
  period_to: string;
  total_cents: number;
  billing_code: string | null;
  billing_name: string | null;
}

export function SoaWorkspace({
  initialFrom,
  initialTo,
  today,
  initialGroups,
  history,
}: {
  initialFrom: string;
  initialTo: string;
  today: string; // PHT yyyy-mm-dd — for the semi-monthly settlement reminder
  initialGroups: SoaGroup[];
  history: SoaHistoryRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'generate' | 'history'>('generate');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [groups, setGroups] = useState<SoaGroup[]>(initialGroups);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, startLoad] = useTransition();
  const [pending, startGen] = useTransition();

  // Reload the unsettled list when the date range changes (debounced).
  const [firstRun, setFirstRun] = useState(true);
  useEffect(() => {
    if (firstRun) { setFirstRun(false); return; }
    if (!from || !to || to < from) return;
    const t = setTimeout(() => {
      startLoad(async () => {
        const data = await loadSoaWorkspace(from, to);
        setGroups(data);
        setSelected(new Set());
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  function toggleSel(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleExp(id: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allSelected = groups.length > 0 && selected.size === groups.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.billing_id)));
  }

  const selTotal = groups.filter((g) => selected.has(g.billing_id)).reduce((s, g) => s + g.total_cents, 0);

  // Semi-monthly cadence: settle each half-month (1–15, 16–EOM). It's "due" when
  // un-stated closed AR exists from a half-month that has already ended.
  const halfStart = Number(today.slice(8, 10)) <= 15 ? `${today.slice(0, 7)}-01` : `${today.slice(0, 7)}-16`;
  const settleOverdue = groups.some((g) => g.orders.some((o) => o.service_date < halfStart));

  function doGenerate() {
    if (selected.size === 0) return toast.error('Select at least one billing destination');
    startGen(async () => {
      const r = await generateSOAForBillings([...selected], from, to);
      if (r.ok) {
        toast.success(`Generated ${r.data?.created} SOA${(r.data?.created ?? 0) > 1 ? 's' : ''}`);
        setSelected(new Set());
        const data = await loadSoaWorkspace(from, to);
        setGroups(data);
        router.refresh(); // refresh history list
        setTab('history');
      } else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reconciliation" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reconciliation</Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <FileText className="size-6 text-primary" /> Revenue SOA
          </h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            Closed AR orders not yet on a statement · intercompany vs third-party
          </p>
        </div>
        {/* segmented toggle */}
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setTab('generate')}
            className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'generate' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}
          >
            Generate SOA
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'history' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}
          >
            SOA History
          </button>
        </div>
      </div>

      {tab === 'generate' ? (
        <>
          <div className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold',
            settleOverdue ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'border-border bg-muted/40 text-muted-foreground',
          )}>
            <CalendarClock className="size-4 shrink-0" />
            {settleOverdue
              ? 'Closed AR from a finished half-month isn’t stated yet — time to issue this period’s SOA.'
              : 'Settle semi-monthly — around the 15th and month-end.'}
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
              </div>
              <p className="ml-auto text-sm font-semibold text-muted-foreground">
                {groups.length} billing · {groups.reduce((s, g) => s + g.bookings, 0)} bookings · {peso(groups.reduce((s, g) => s + g.total_cents, 0))}
              </p>
            </div>
          </Card>

          {groups.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <FilePlus2 className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">
                  {loading ? 'Loading…' : 'No un-stated closed AR orders in this range.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 px-1 cursor-pointer w-fit">
                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allSelected} onChange={toggleAll} />
                <span className="text-sm font-bold">Select All</span>
              </label>

              {groups.map((g) => {
                const isOpen = expanded.has(g.billing_id);
                return (
                  <Card key={g.billing_id} className="p-0 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={selected.has(g.billing_id)}
                        onChange={() => toggleSel(g.billing_id)}
                      />
                      <button type="button" onClick={() => toggleExp(g.billing_id)} className="text-muted-foreground hover:text-foreground">
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                      <button type="button" onClick={() => toggleExp(g.billing_id)} className="flex items-center gap-2 text-left">
                        <span className="font-bold">{g.code}</span>
                        <span className="text-sm text-muted-foreground">{g.name}</span>
                        <span className="text-xs font-medium text-muted-foreground">({g.bookings} booking{g.bookings > 1 ? 's' : ''})</span>
                        <Badge variant="secondary" className="font-bold capitalize">{g.settlement_type.replace('_', '-')}</Badge>
                      </button>
                      <span className="ml-auto text-base font-extrabold tabular">Total: {peso(g.total_cents)}</span>
                    </div>
                    {isOpen && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-32 font-bold">Date</TableHead>
                            <TableHead className="w-44 font-bold">Order No</TableHead>
                            <TableHead className="font-bold">Guest Name</TableHead>
                            <TableHead className="font-bold">Service</TableHead>
                            <TableHead className="w-20 font-bold text-right">Mins</TableHead>
                            <TableHead className="w-32 font-bold text-right pr-4">Net</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.orders.flatMap((o) =>
                            (o.lines.length ? o.lines : [{ guest: '—', service: '—', duration_minutes: null, gross_cents: o.total_cents, discount_cents: 0, net_cents: o.total_cents }]).map((ln, i) => (
                              <TableRow key={`${o.id}-${i}`}>
                                <TableCell className="font-medium tabular text-muted-foreground">{i === 0 ? o.service_date : ''}</TableCell>
                                <TableCell className="font-mono font-bold">
                                  {i === 0 ? <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link> : ''}
                                </TableCell>
                                <TableCell className="font-medium">{ln.guest}</TableCell>
                                <TableCell className="font-medium">{ln.service}</TableCell>
                                <TableCell className="tabular text-right text-muted-foreground">{ln.duration_minutes ?? '—'}</TableCell>
                                <TableCell className="font-bold tabular text-right pr-4">{peso(ln.net_cents)}</TableCell>
                              </TableRow>
                            )),
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </Card>
                );
              })}

              {selected.size > 0 && (
                <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 shadow-sm">
                  <span className="text-sm font-bold">
                    {selected.size} billing selected · {peso(selTotal)}
                  </span>
                  <Button onClick={doGenerate} disabled={pending}>
                    {pending ? 'Generating…' : `Generate SOA (${selected.size})`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      ) : history.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-10 text-center">
            <FileText className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-semibold text-muted-foreground mt-3">No statements generated yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">SOA No</TableHead>
                <TableHead className="font-bold">Billing</TableHead>
                <TableHead className="w-28 font-bold">Type</TableHead>
                <TableHead className="font-bold">Period</TableHead>
                <TableHead className="w-32 font-bold text-right">Total</TableHead>
                <TableHead className="w-28 font-bold">Status</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-bold">{s.soa_no}</TableCell>
                  <TableCell className="font-medium">{s.billing_code ? `${s.billing_code} — ${s.billing_name}` : '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-bold capitalize">{(s.settlement_type ?? '').replace('_', '-')}</Badge></TableCell>
                  <TableCell className="font-medium tabular text-muted-foreground">{s.period_from} → {s.period_to}</TableCell>
                  <TableCell className="font-bold tabular text-right">{peso(s.total_cents)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="font-bold capitalize">{s.status.replace('_', ' ')}</Badge></TableCell>
                  <TableCell><div className="flex justify-end"><SoaActions id={s.id} status={s.status} /></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
