'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, FileText, FilePlus2, CalendarClock, Download, Wallet, Check, AlertCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
import { SoaPaymentsList } from '@/components/reconciliation/soa-payments-list';
import { StatusBadge } from '@/components/reconciliation/status-badge';
import { loadSoaWorkspace, generateSOAGroups, type SoaGroup, type SoaHistoryRow, type ArBalance } from '@/app/(dashboard)/reconciliation/soa/actions';

export type { SoaHistoryRow, ArBalance };

// First and last day of the current month in PHT. Used as the history
// filter default — desk's normal workflow is "review this month".
function currentMonthPHT(): { from: string; to: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const ym = today.slice(0, 7);
  const [y, m] = today.split('-').map(Number);
  const eom = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(eom).padStart(2, '0')}` };
}

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

// Status badge variants + tooltips live in `status-badge.tsx`. The History
// table feeds `<StatusBadge kind="soa" />` directly; no per-file dictionary.

// 'active' = the default lens; hides void since a void was reversed and only
// matters for audit. 'all' stays available; specific statuses (incl. Void)
// also selectable for audit pulls.
const HIST_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All (incl. void)' },
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
  branches,
  initialView = 'ar',
}: {
  initialFrom: string;
  initialTo: string;
  today: string; // PHT yyyy-mm-dd — for the semi-monthly settlement reminder
  initialGroups: SoaGroup[];
  history: SoaHistoryRow[];
  arBalance: ArBalance;
  branches: { id: string; code: string }[];
  initialView?: 'generate' | 'history' | 'ar';
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'generate' | 'history' | 'ar'>(initialView);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [groups, setGroups] = useState<SoaGroup[]>(initialGroups);
  // Branch lens for the Generate view — 'all' or one branch id.
  const [branchFilter, setBranchFilter] = useState<string>('all');
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

  // The Generate list through the branch lens; selection follows the lens.
  const visibleGroups = useMemo(
    () => (branchFilter === 'all' ? groups : groups.filter((g) => g.branch_id === branchFilter)),
    [groups, branchFilter],
  );
  function pickBranch(id: string) {
    setBranchFilter(id);
    setSelected(new Set());
  }
  const allSelected = visibleGroups.length > 0 && selected.size === visibleGroups.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleGroups.map((g) => g.key)));
  }

  const selTotal = visibleGroups.filter((g) => selected.has(g.key)).reduce((s, g) => s + g.total_cents, 0);

  // Semi-monthly cadence: settle each half-month (1–15, 16–EOM). It's "due" when
  // un-stated closed AR exists from a half-month that has already ended.
  const halfStart = Number(today.slice(8, 10)) <= 15 ? `${today.slice(0, 7)}-01` : `${today.slice(0, 7)}-16`;
  const settleOverdue = visibleGroups.some((g) => g.orders.some((o) => o.service_date < halfStart));

  function doGenerate() {
    if (selected.size === 0) return toast.error('Select at least one statement to generate');
    const sel = visibleGroups.filter((g) => selected.has(g.key)).map((g) => ({ billing_to_id: g.billing_id, branch_id: g.branch_id }));
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
  // filter — Select all selects the currently-visible rows only.
  // Default = current month (PHT). Reset link restores the same default. ---
  const defaultMonth = useMemo(() => currentMonthPHT(), []);
  const [histFrom, setHistFrom] = useState(defaultMonth.from);
  const [histTo, setHistTo] = useState(defaultMonth.to);
  const [histStatus, setHistStatus] = useState('active');
  const filteredHistory = useMemo(
    () =>
      history.filter((s) => {
        if (histFrom && s.period_to < histFrom) return false;
        if (histTo && s.period_from > histTo) return false;
        // 'active' hides void by default; 'all' shows it; otherwise the value
        // is a specific status code (incl. 'void' for audit pulls).
        if (histStatus === 'active' && s.status === 'void') return false;
        if (histStatus !== 'active' && histStatus !== 'all' && s.status !== histStatus) return false;
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

  // Grand totals across the current filter window. Same void rule as the Tip
  // and Commission Settlement footers — site-wide reconciliation convention:
  //   · Void statements are EXCLUDED from monetary sums (total / outstanding).
  //     A void was reversed by releasing its orders back to the open pool, so
  //     counting its amount would double-count: once on the void row, once on
  //     the re-issued statement that captured those same orders.
  //   · Void COUNT is surfaced separately ("X void excluded") so the desk can
  //     see how many were reversed without re-filtering by status.
  // (Revenue Confirm has no void path — data layer only loads status='closed';
  //  AR Balance only lists open SOAs — neither needs this split.)
  const nonVoid = filteredHistory.filter((s) => s.status !== 'void');
  const histGrandCount = nonVoid.length;
  const histVoidCount = filteredHistory.length - histGrandCount;
  const histGrandTotal = nonVoid.reduce((sum, s) => sum + s.total_cents, 0);
  const histGrandOutstanding = nonVoid.reduce((sum, s) => sum + s.outstanding_cents, 0);

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
              <p className="text-sm font-semibold text-muted-foreground self-end mb-2">
                {visibleGroups.length} statement{visibleGroups.length === 1 ? '' : 's'} (billing × branch) · {visibleGroups.reduce((s, g) => s + g.bookings, 0)} bookings · {peso(visibleGroups.reduce((s, g) => s + g.total_cents, 0))}
              </p>
              {/* Branch lens — statements never mix branches, so this just narrows the list. */}
              <div className="ml-auto flex items-center gap-1.5 self-end mb-1">
                {[{ id: 'all', code: 'All' }, ...branches].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => pickBranch(b.id)}
                    className={cn('rounded-lg px-3 py-1.5 text-sm font-bold transition-colors', b.id === branchFilter ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent')}
                  >
                    {b.code}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {visibleGroups.length === 0 ? (
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

              {visibleGroups.map((g) => {
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
                          {g.orders.map((o) => (
                            <Fragment key={o.id}>
                              {/* Service context — what was delivered (not the statement money). */}
                              {o.lines.map((ln, i) => (
                                <TableRow key={`${o.id}-svc-${i}`}>
                                  <TableCell className="font-medium tabular text-muted-foreground">{i === 0 ? o.service_date : ''}</TableCell>
                                  <TableCell className="font-mono font-bold">
                                    {i === 0 ? <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link> : ''}
                                  </TableCell>
                                  <TableCell className="font-medium">{ln.guest}</TableCell>
                                  <TableCell className="font-medium">{ln.service}</TableCell>
                                  <TableCell className="tabular text-right text-muted-foreground">{ln.duration_minutes ?? '—'}</TableCell>
                                  <TableCell className="tabular text-right pr-4 text-muted-foreground">{peso(ln.net_cents)}</TableCell>
                                </TableRow>
                              ))}
                              {/* Statement money — the AR folio payment/refund lines whose net
                                  IS this order's amount on the statement. */}
                              {o.folio.map((f, i) => (
                                <TableRow key={f.id} className="bg-primary/[0.04] hover:bg-primary/[0.06]">
                                  <TableCell className="font-medium tabular text-muted-foreground pl-8">
                                    {o.lines.length === 0 && i === 0 ? o.service_date : f.posted_at.slice(0, 10)}
                                  </TableCell>
                                  <TableCell className="font-mono font-bold">
                                    {o.lines.length === 0 && i === 0 ? <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link> : ''}
                                  </TableCell>
                                  <TableCell className="font-semibold">{f.guest}</TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Badge variant="outline" className={cn('font-bold shrink-0', f.kind === 'refund' ? 'text-destructive border-destructive/40' : 'text-primary border-primary/40')}>
                                        {f.kind === 'refund' ? 'AR refund' : 'AR charge'}
                                      </Badge>
                                      <span className="text-xs font-medium text-muted-foreground">
                                        {f.created_by ? `by ${f.created_by}` : ''}{f.created_by && f.note ? ' · ' : ''}{f.note ?? ''}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell />
                                  <TableCell className={cn('font-bold tabular text-right pr-4', f.kind === 'refund' && 'text-destructive')}>
                                    {f.kind === 'refund' ? `−${peso(f.amount_cents)}` : peso(f.amount_cents)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </Fragment>
                          ))}
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
              {(histFrom !== defaultMonth.from || histTo !== defaultMonth.to || histStatus !== 'active') && (
                <button type="button" onClick={() => { setHistFrom(defaultMonth.from); setHistTo(defaultMonth.to); setHistStatus('active'); }} className="self-end mb-2 text-xs font-semibold text-primary hover:underline">
                  Reset to this month
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
                        <TableCell className="font-mono font-bold">
                          <div className="flex flex-col gap-0.5">
                            <span>{s.soa_no}</span>
                            {/* ERP voucher chip — stacked under the SOA No so the
                                Acumatica F-number is visible at a glance without
                                expanding the row. Failed-post rows surface the
                                error tooltip + an AlertCircle. */}
                            {s.gl_batch_nbr ? (
                              <span className="inline-flex w-fit items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                                <Check className="size-3" /> GL #{s.gl_batch_nbr}
                              </span>
                            ) : s.posting_status === 'failed' ? (
                              <span
                                title={s.posting_error ?? 'ERP posting failed'}
                                className="inline-flex w-fit items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-destructive"
                              >
                                <AlertCircle className="size-3" /> Posting failed
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{s.billing_code ? `${s.billing_code} — ${s.billing_name}` : '—'}</TableCell>
                        <TableCell className="text-center"><Badge variant="secondary" className="font-bold capitalize">{(s.settlement_type ?? '').replace('_', '-')}</Badge></TableCell>
                        <TableCell className="font-medium tabular text-muted-foreground text-center">{s.period_from} → {s.period_to}</TableCell>
                        <TableCell className="font-bold tabular text-right pr-2">{peso(s.total_cents)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={s.status} kind="soa" /></TableCell>
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
                              <>
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
                                  {s.detail.map((o) => (
                                    <Fragment key={o.id}>
                                      {o.lines.map((ln, i) => (
                                        <TableRow key={`${o.id}-svc-${i}`}>
                                          <TableCell className="font-medium tabular text-muted-foreground pl-6">{i === 0 ? o.service_date : ''}</TableCell>
                                          <TableCell className="font-mono font-bold">
                                            {i === 0 ? <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link> : ''}
                                          </TableCell>
                                          <TableCell className="font-medium pl-4">{ln.guest}</TableCell>
                                          <TableCell className="font-medium">{ln.service}</TableCell>
                                          <TableCell className="tabular text-center text-muted-foreground">{ln.duration_minutes ?? '—'}</TableCell>
                                          <TableCell className="tabular text-right pr-2 text-muted-foreground">{peso(ln.net_cents)}</TableCell>
                                          <TableCell className="w-28" />
                                          <TableCell className="w-32" />
                                        </TableRow>
                                      ))}
                                      {o.folio.map((f, i) => (
                                        <TableRow key={f.id} className="bg-primary/[0.04] hover:bg-primary/[0.06]">
                                          <TableCell className="font-medium tabular text-muted-foreground pl-10">
                                            {o.lines.length === 0 && i === 0 ? o.service_date : f.posted_at.slice(0, 10)}
                                          </TableCell>
                                          <TableCell className="font-mono font-bold">
                                            {o.lines.length === 0 && i === 0 ? <Link href={`/sales-orders/${o.id}`} className="hover:text-primary">{o.order_no}</Link> : ''}
                                          </TableCell>
                                          <TableCell className="font-semibold pl-4">{f.guest}</TableCell>
                                          <TableCell>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <Badge variant="outline" className={cn('font-bold shrink-0', f.kind === 'refund' ? 'text-destructive border-destructive/40' : 'text-primary border-primary/40')}>
                                                {f.kind === 'refund' ? 'AR refund' : 'AR charge'}
                                              </Badge>
                                              <span className="text-xs font-medium text-muted-foreground">
                                                {f.created_by ? `by ${f.created_by}` : ''}{f.created_by && f.note ? ' · ' : ''}{f.note ?? ''}
                                              </span>
                                            </div>
                                          </TableCell>
                                          <TableCell />
                                          <TableCell className={cn('font-bold tabular text-right pr-2', f.kind === 'refund' && 'text-destructive')}>
                                            {f.kind === 'refund' ? `−${peso(f.amount_cents)}` : peso(f.amount_cents)}
                                          </TableCell>
                                          <TableCell className="w-28" />
                                          <TableCell className="w-32" />
                                        </TableRow>
                                      ))}
                                    </Fragment>
                                  ))}
                                </TableBody>
                              </Table>
                              {/* Payment ledger — third-party SOAs collect via
                                  Record Payment; surface that history here so
                                  the History detail matches what AR Balance
                                  shows under the same SOA. Intercompany SOAs
                                  settle by cost transfer (no payments) so this
                                  section is hidden for them. */}
                              {s.settlement_type === 'third_party' && (
                                <div className="px-6 py-4 border-t border-border">
                                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Payment ledger</p>
                                  <SoaPaymentsList soaId={s.id} />
                                </div>
                              )}
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
              {/* Grand Totals — sum of non-void SOAs in the current filter
                  window. Money columns align under their headers (Total /
                  Status uses the slot to surface a separate "void" count so
                  the desk sees both numbers without re-filtering). */}
              <TableFooter>
                <TableRow className="border-t-2 border-border bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={6} className="font-extrabold uppercase text-xs tracking-wider text-muted-foreground pl-4">
                    Grand Totals
                    <span className="ml-2 text-muted-foreground/70 normal-case tracking-normal text-[11px]">
                      ({histGrandCount} statement{histGrandCount === 1 ? '' : 's'}{histVoidCount > 0 ? ` · ${histVoidCount} void excluded` : ''})
                    </span>
                  </TableCell>
                  <TableCell className="font-extrabold tabular text-right pr-2 bg-muted/60">{peso(histGrandTotal)}</TableCell>
                  <TableCell colSpan={2} className="bg-muted/60 text-right pr-4 text-xs font-bold text-muted-foreground">
                    {histGrandOutstanding > 0 ? `${peso(histGrandOutstanding)} outstanding` : 'all settled'}
                  </TableCell>
                </TableRow>
              </TableFooter>
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
