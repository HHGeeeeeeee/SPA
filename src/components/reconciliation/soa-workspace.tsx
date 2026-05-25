'use client';

import { Fragment, useEffect, useState, useTransition } from 'react';
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
import { loadSoaWorkspace, generateSOAForBillings, settleSOABatch, type SoaGroup, type SoaHistoryRow } from '@/app/(dashboard)/reconciliation/soa/actions';

export type { SoaHistoryRow };

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', issued: 'default', partial_paid: 'secondary', settled: 'default', void: 'destructive',
};

// Statuses that can be batch-settled from History.
const SETTLEABLE = new Set(['issued', 'partial_paid']);

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
  // History tab: separate select (settleable rows) + expand state.
  const [histSel, setHistSel] = useState<Set<string>>(new Set());
  const [histExp, setHistExp] = useState<Set<string>>(new Set());
  const [settling, startSettle] = useTransition();

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

  // --- History batch-settle ---
  const settleable = history.filter((s) => SETTLEABLE.has(s.status));
  const allHistSelected = settleable.length > 0 && histSel.size === settleable.length;
  function toggleHistSel(id: string) {
    setHistSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleHistExp(id: string) {
    setHistExp((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllHist() {
    setHistSel(allHistSelected ? new Set() : new Set(settleable.map((s) => s.id)));
  }
  const histSelTotal = history.filter((s) => histSel.has(s.id)).reduce((sum, s) => sum + s.total_cents, 0);
  function doSettle() {
    if (histSel.size === 0) return;
    startSettle(async () => {
      const r = await settleSOABatch([...histSel]);
      if (r.ok) {
        toast.success(`Settled ${r.data?.settled} SOA${(r.data?.settled ?? 0) > 1 ? 's' : ''}`);
        setHistSel(new Set());
        router.refresh();
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
              <div className="sticky top-2 z-20 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allSelected} onChange={toggleAll} />
                  <span className="text-sm font-bold">Select All</span>
                </label>
                {selected.size > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{selected.size} billing · {peso(selTotal)}</span>
                    <Button size="sm" onClick={doGenerate} disabled={pending}>{pending ? 'Generating…' : `Generate SOA (${selected.size})`}</Button>
                  </div>
                )}
              </div>

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
        <div className="flex flex-col gap-3">
          {/* Batch-settle bar — select issued/partial-paid statements and settle
              (and post, once ERP wiring lands) them in one pass. */}
          {settleable.length > 0 && (
            <div className="sticky top-2 z-20 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allHistSelected} onChange={toggleAllHist} />
                <span className="text-sm font-bold">Select all issued ({settleable.length})</span>
              </label>
              {histSel.size > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold">{histSel.size} SOA · {peso(histSelTotal)}</span>
                  <Button size="sm" onClick={doSettle} disabled={settling}>{settling ? 'Settling…' : `Settle & post (${histSel.size})`}</Button>
                </div>
              )}
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            {/* table-fixed: exact column widths so the nested detail's Net lines
                up under Total (same w-32 + trailing w-28 + w-44). */}
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-8" />
                  <TableHead className="font-bold">SOA No</TableHead>
                  <TableHead className="font-bold">Billing</TableHead>
                  <TableHead className="w-28 font-bold text-center">Type</TableHead>
                  <TableHead className="font-bold">Period</TableHead>
                  <TableHead className="w-32 font-bold text-right">Total</TableHead>
                  <TableHead className="w-28 font-bold text-center">Status</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s) => {
                  const isOpen = histExp.has(s.id);
                  const canSettle = SETTLEABLE.has(s.status);
                  return (
                    <Fragment key={s.id}>
                      <TableRow className={cn(canSettle && histSel.has(s.id) && 'bg-primary/5')}>
                        <TableCell className="pr-0">
                          <button type="button" onClick={() => toggleHistExp(s.id)} className="text-muted-foreground hover:text-foreground">
                            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="pr-0">
                          {canSettle && (
                            <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={histSel.has(s.id)} onChange={() => toggleHistSel(s.id)} />
                          )}
                        </TableCell>
                        <TableCell className="font-mono font-bold">{s.soa_no}</TableCell>
                        <TableCell className="font-medium">{s.billing_code ? `${s.billing_code} — ${s.billing_name}` : '—'}</TableCell>
                        <TableCell className="text-center"><Badge variant="secondary" className="font-bold capitalize">{(s.settlement_type ?? '').replace('_', '-')}</Badge></TableCell>
                        <TableCell className="font-medium tabular text-muted-foreground">{s.period_from} → {s.period_to}</TableCell>
                        <TableCell className="font-bold tabular text-right">{peso(s.total_cents)}</TableCell>
                        <TableCell className="text-center"><Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="font-bold capitalize">{s.status.replace('_', ' ')}</Badge></TableCell>
                        <TableCell><div className="flex justify-end"><SoaActions id={s.id} status={s.status} /></div></TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={9} className="p-0">
                            {s.detail.length === 0 ? (
                              <p className="px-6 py-4 text-sm font-semibold text-muted-foreground">
                                {s.status === 'void' ? 'Voided — orders released back to Generate.' : 'No order detail.'}
                              </p>
                            ) : (
                              <Table className="table-fixed">
                                {/* Net column + trailing spacers mirror the parent's
                                    Total (w-32) + Status (w-28) + Actions (w-44). */}
                                <colgroup>
                                  <col className="w-32" />
                                  <col className="w-48" />
                                  <col />
                                  <col />
                                  <col className="w-20" />
                                  <col className="w-32" />
                                  <col className="w-28" />
                                  <col className="w-44" />
                                </colgroup>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="font-bold pl-6">Date</TableHead>
                                    <TableHead className="font-bold">Order No</TableHead>
                                    <TableHead className="font-bold pl-4">Guest Name</TableHead>
                                    <TableHead className="font-bold">Service</TableHead>
                                    <TableHead className="font-bold text-center">Mins</TableHead>
                                    <TableHead className="font-bold text-right">Net</TableHead>
                                    <TableHead />
                                    <TableHead />
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {s.detail.flatMap((o) =>
                                    (o.lines.length ? o.lines : [{ guest: '—', service: '—', duration_minutes: null, gross_cents: o.total_cents, discount_cents: 0, net_cents: o.total_cents }]).map((ln, i) => (
                                      <TableRow key={`${o.id}-${i}`}>
                                        <TableCell className="font-medium tabular text-muted-foreground pl-6">{i === 0 ? o.service_date : ''}</TableCell>
                                        <TableCell className="font-mono font-bold">
                                          {i === 0 ? <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link> : ''}
                                        </TableCell>
                                        <TableCell className="font-medium pl-4">{ln.guest}</TableCell>
                                        <TableCell className="font-medium">{ln.service}</TableCell>
                                        <TableCell className="tabular text-center text-muted-foreground">{ln.duration_minutes ?? '—'}</TableCell>
                                        <TableCell className="font-bold tabular text-right">{peso(ln.net_cents)}</TableCell>
                                        <TableCell className="w-28" />
                                        <TableCell className="w-44" />
                                      </TableRow>
                                    )),
                                  )}
                                </TableBody>
                              </Table>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
