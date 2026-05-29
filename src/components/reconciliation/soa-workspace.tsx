'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, FileText, FilePlus2, CalendarClock, Download, Wallet } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { SoaActions } from '@/components/reconciliation/soa-actions';
import { ArBalanceExplorer } from '@/components/reconciliation/ar-balance-explorer';
import { loadSoaWorkspace, generateSOAGroups, type SoaGroup, type SoaHistoryRow, type ArBalance } from '@/app/(dashboard)/reconciliation/soa/actions';

export type { SoaHistoryRow, ArBalance };

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', issued: 'default', partial_paid: 'secondary', settled: 'default', void: 'destructive',
};

const HIST_STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'issued', label: 'Issued' },
  { value: 'partial_paid', label: 'Partial paid' },
  { value: 'settled', label: 'Settled' },
  { value: 'void', label: 'Void' },
];

export function SoaWorkspace({
  initialFrom,
  initialTo,
  today,
  initialGroups,
  history,
  arBalance,
  initialView = 'ar',
}: {
  initialFrom: string;
  initialTo: string;
  today: string; // PHT yyyy-mm-dd — for the semi-monthly settlement reminder
  initialGroups: SoaGroup[];
  history: SoaHistoryRow[];
  arBalance: ArBalance;
  initialView?: 'generate' | 'history' | 'ar';
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'generate' | 'history' | 'ar'>(initialView);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [groups, setGroups] = useState<SoaGroup[]>(initialGroups);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, startLoad] = useTransition();
  const [pending, startGen] = useTransition();
  // History tab: select (for PDF) + expand state. Collection (settle / record
  // payment) lives in the AR Balance view, so History no longer settles.
  const [histSel, setHistSel] = useState<Set<string>>(new Set());
  const [histExp, setHistExp] = useState<Set<string>>(new Set());

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
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.key)));
  }

  const selTotal = groups.filter((g) => selected.has(g.key)).reduce((s, g) => s + g.total_cents, 0);

  // Semi-monthly cadence: settle each half-month (1–15, 16–EOM). It's "due" when
  // un-stated closed AR exists from a half-month that has already ended.
  const halfStart = Number(today.slice(8, 10)) <= 15 ? `${today.slice(0, 7)}-01` : `${today.slice(0, 7)}-16`;
  const settleOverdue = groups.some((g) => g.orders.some((o) => o.service_date < halfStart));

  function doGenerate() {
    if (selected.size === 0) return toast.error('Select at least one statement to generate');
    const sel = groups.filter((g) => selected.has(g.key)).map((g) => ({ billing_to_id: g.billing_id, branch_id: g.branch_id }));
    startGen(async () => {
      const r = await generateSOAGroups(sel, from, to);
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

  // --- History filter (date + status). Date filter is overlap: a SOA is in
  // range if its period intersects the chosen window. Selection respects the
  // filter — Select all selects the currently-visible rows only. ---
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');
  const [histStatus, setHistStatus] = useState('all');
  const filteredHistory = useMemo(
    () =>
      history.filter((s) => {
        if (histFrom && s.period_to < histFrom) return false;
        if (histTo && s.period_from > histTo) return false;
        if (histStatus !== 'all' && s.status !== histStatus) return false;
        return true;
      }),
    [history, histFrom, histTo, histStatus],
  );

  // --- History selection: ANY statement can be selected (for PDF download);
  // settling acts only on the settleable subset of the selection. ---
  const allHistSelected = filteredHistory.length > 0 && filteredHistory.every((s) => histSel.has(s.id));
  function toggleHistSel(id: string) {
    setHistSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleHistExp(id: string) {
    setHistExp((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllHist() {
    setHistSel((prev) => {
      const n = new Set(prev);
      if (allHistSelected) for (const s of filteredHistory) n.delete(s.id);
      else for (const s of filteredHistory) n.add(s.id);
      return n;
    });
  }
  // 1 selected → that statement's PDF; many → a ZIP of separate PDFs.
  const pdfHref = histSel.size === 1
    ? `/reconciliation/soa/${[...histSel][0]}/pdf`
    : `/reconciliation/soa/pdf-zip?ids=${[...histSel].join(',')}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reconciliation" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reconciliation</Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <Wallet className="size-6 text-primary" /> Accounts Receivable
          </h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            Outstanding receivables by billing destination · generate statements · collect &amp; settle
          </p>
        </div>
        {/* segmented toggle — AR Balance is the default landing view */}
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setTab('ar')}
            className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'ar' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}
          >
            AR Balance
          </button>
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

      {tab === 'generate' && (
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
                {groups.length} statement{groups.length === 1 ? '' : 's'} (billing × branch) · {groups.reduce((s, g) => s + g.bookings, 0)} bookings · {peso(groups.reduce((s, g) => s + g.total_cents, 0))}
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
                  <span className="text-xs font-medium text-muted-foreground">— pick billing × branch groups to generate statements</span>
                </label>
                {selected.size > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{selected.size} statement{selected.size > 1 ? 's' : ''} · {peso(selTotal)}</span>
                    <Button size="sm" onClick={doGenerate} disabled={pending}>{pending ? 'Generating…' : `Generate SOA (${selected.size})`}</Button>
                  </div>
                )}
              </div>

              {groups.map((g) => {
                const isOpen = expanded.has(g.key);
                return (
                  <Card key={g.key} className="p-0 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={selected.has(g.key)}
                        onChange={() => toggleSel(g.key)}
                      />
                      <button type="button" onClick={() => toggleExp(g.key)} className="text-muted-foreground hover:text-foreground">
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                      <button type="button" onClick={() => toggleExp(g.key)} className="flex items-center gap-2 text-left">
                        <span className="font-bold">{g.code}</span>
                        <span className="text-sm text-muted-foreground">{g.name}</span>
                        <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary font-mono">{g.branch_code}</span>
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
      )}

      {tab === 'history' && (
        <div className="flex flex-col gap-3">
          {/* Filter row — narrow the list by SOA period (overlap) and status.
              Selection respects the filter: "Select all" picks the visible rows
              only, so a follow-up ZIP download is scoped to what's filtered. */}
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Date From</Label>
                <Input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} className="w-40" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Date To</Label>
                <Input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} className="w-40" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold">Status</Label>
                <Select items={HIST_STATUS_OPTIONS} value={histStatus} onValueChange={(v) => v && setHistStatus(v)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HIST_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(histFrom || histTo || histStatus !== 'all') && (
                <button type="button" onClick={() => { setHistFrom(''); setHistTo(''); setHistStatus('all'); }} className="self-end mb-2 text-xs font-semibold text-primary hover:underline">
                  Clear filters
                </button>
              )}
              <span className="ml-auto self-end mb-2 text-xs font-semibold text-muted-foreground">
                {filteredHistory.length} of {history.length}
              </span>
            </div>
          </Card>

          {history.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <FileText className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">No statements generated yet.</p>
              </CardContent>
            </Card>
          ) : filteredHistory.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <FileText className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">No statements match the filters.</p>
              </CardContent>
            </Card>
          ) : (
            <>
          {/* Selection bar — pick statements to download as PDF. Collection
              (settle / record payment) is done in the AR Balance view. */}
          <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allHistSelected} onChange={toggleAllHist} />
              <span className="text-sm font-bold">Select all ({filteredHistory.length})</span>
              <span className="text-xs font-medium text-muted-foreground">— pick statements to download as PDF / ZIP</span>
            </label>
            {histSel.size > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold">{histSel.size} selected</span>
                <a
                  href={pdfHref}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
                >
                  <Download className="size-4" /> Download PDF ({histSel.size})
                </a>
              </div>
            )}
          </div>

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
                  <TableHead className="font-bold text-center">Period</TableHead>
                  <TableHead className="w-32 font-bold text-right pr-2">Total</TableHead>
                  <TableHead className="w-28 font-bold text-center">Status</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((s) => {
                  const isOpen = histExp.has(s.id);
                  return (
                    <Fragment key={s.id}>
                      <TableRow className={cn(histSel.has(s.id) && 'bg-primary/5')}>
                        <TableCell className="pr-0">
                          <button type="button" onClick={() => toggleHistExp(s.id)} className="text-muted-foreground hover:text-foreground">
                            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="pr-0">
                          <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={histSel.has(s.id)} onChange={() => toggleHistSel(s.id)} />
                        </TableCell>
                        <TableCell className="font-mono font-bold">{s.soa_no}</TableCell>
                        <TableCell className="font-medium">{s.billing_code ? `${s.billing_code} — ${s.billing_name}` : '—'}</TableCell>
                        <TableCell className="text-center"><Badge variant="secondary" className="font-bold capitalize">{(s.settlement_type ?? '').replace('_', '-')}</Badge></TableCell>
                        <TableCell className="font-medium tabular text-muted-foreground text-center">{s.period_from} → {s.period_to}</TableCell>
                        <TableCell className="font-bold tabular text-right pr-2">{peso(s.total_cents)}</TableCell>
                        <TableCell className="text-center"><Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="font-bold capitalize">{s.status.replace('_', ' ')}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <SoaActions id={s.id} status={s.status} settlementType={s.settlement_type} outstandingCents={s.outstanding_cents} collect={false} />
                          </div>
                        </TableCell>
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
                                    Total (w-32) + Status (w-28) + Actions (w-32). */}
                                <colgroup>
                                  <col className="w-32" />
                                  <col className="w-48" />
                                  <col />
                                  <col />
                                  <col className="w-20" />
                                  <col className="w-32" />
                                  <col className="w-28" />
                                  <col className="w-32" />
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
                                        <TableCell className="font-bold tabular text-right pr-2">{peso(ln.net_cents)}</TableCell>
                                        <TableCell className="w-28" />
                                        <TableCell className="w-32" />
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
        </>
      )}
        </div>
      )}

      {tab === 'ar' && <ArBalanceExplorer ar={arBalance} />}
    </div>
  );
}
