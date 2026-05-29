'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, Download, Percent } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import { loadCommissionGroups, settleCommission, voidCommissionPeriod, type CommGroup } from '@/app/(dashboard)/reconciliation/commission/actions';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', closed: 'default', void: 'destructive',
};

const HIST_STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
  { value: 'void', label: 'Void' },
];

interface Branch { id: string; code: string; name: string }
export interface CommHistoryRow {
  id: string;
  period_no: string;
  branch_code: string | null;
  status: string;
  period_from: string;
  period_to: string;
  total_sessions: number;
  total_commission_cents: number;
  confirmed_at: string | null;
  therapists: string[];
  detail: {
    therapist: string;
    sessions: number;
    gross_cents: number;
    commission_cents: number;
    lines: { service_date: string; order_no: string; service: string; duration_minutes: number | null; gross_cents: number; rate: number; commission_cents: number; warmup: boolean }[];
  }[];
}

export function CommissionSettlementWorkspace({
  branches,
  initialBranchId,
  initialFrom,
  initialTo,
  initialGroups,
  history,
}: {
  branches: Branch[];
  initialBranchId: string;
  initialFrom: string;
  initialTo: string;
  initialGroups: CommGroup[];
  history: CommHistoryRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'generate' | 'history'>('generate');
  const [branchId, setBranchId] = useState(initialBranchId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [groups, setGroups] = useState<CommGroup[]>(initialGroups);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [histExpanded, setHistExpanded] = useState<Set<string>>(new Set());
  // History filter (date overlap + status) and selection-for-PDF state.
  // Mirrors the SOA / Tip history pattern.
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');
  const [histStatus, setHistStatus] = useState('all');
  const [histSel, setHistSel] = useState<Set<string>>(new Set());
  const [voidConfirmId, setVoidConfirmId] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [pending, startGen] = useTransition();

  const [firstRun, setFirstRun] = useState(true);
  useEffect(() => {
    if (firstRun) { setFirstRun(false); return; }
    if (!branchId || !from || !to || to < from) return;
    const t = setTimeout(() => {
      startLoad(async () => {
        const data = await loadCommissionGroups(branchId, from, to);
        setGroups(data);
        setSelected(new Set());
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, from, to]);

  function toggleSel(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleExp(id: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allSelected = groups.length > 0 && selected.size === groups.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.therapist_id)));
  }

  const selGroups = groups.filter((g) => selected.has(g.therapist_id));
  const selTotal = selGroups.reduce((s, g) => s + g.commission_cents, 0);

  function doSettle() {
    if (selected.size === 0) return toast.error('Select at least one therapist');
    startGen(async () => {
      const r = await settleCommission({ branch_id: branchId, from, to, therapist_ids: [...selected] });
      if (r.ok) {
        toast.success(`Settled ${r.data?.therapists} therapist(s)`);
        setSelected(new Set());
        const data = await loadCommissionGroups(branchId, from, to);
        setGroups(data);
        router.refresh();
        setTab('history');
      } else toast.error(r.error);
    });
  }

  function doVoid(id: string) {
    startGen(async () => {
      const r = await voidCommissionPeriod(id);
      if (r.ok) { toast.success('Period voided'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  const grandComm = groups.reduce((s, g) => s + g.commission_cents, 0);
  const grandSessions = groups.reduce((s, g) => s + g.sessions, 0);

  const filteredHistory = useMemo(
    () =>
      history.filter((p) => {
        if (histFrom && p.period_to < histFrom) return false;
        if (histTo && p.period_from > histTo) return false;
        if (histStatus !== 'all' && p.status !== histStatus) return false;
        return true;
      }),
    [history, histFrom, histTo, histStatus],
  );
  // Void periods are shown for audit but not selectable for PDF.
  const selectable = filteredHistory.filter((p) => p.status !== 'void');
  // Grand totals (non-void only). Void commission periods were reversed —
  // their lines went back to the open pool so they shouldn't double-count.
  const histGrandSessions = selectable.reduce((s, x) => s + x.total_sessions, 0);
  const histGrandCommission = selectable.reduce((s, x) => s + x.total_commission_cents, 0);
  const histGrandCount = selectable.length;
  const histVoidCount = filteredHistory.length - histGrandCount;
  const allHistSelected = selectable.length > 0 && selectable.every((p) => histSel.has(p.id));
  function toggleHistSel(id: string) {
    setHistSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllHist() {
    setHistSel((prev) => {
      const n = new Set(prev);
      if (allHistSelected) for (const p of selectable) n.delete(p.id);
      else for (const p of selectable) n.add(p.id);
      return n;
    });
  }
  // 1 selected → that period's PDF; many → a ZIP of separate PDFs.
  const pdfHref = histSel.size === 1
    ? `/reconciliation/commission/${[...histSel][0]}/pdf`
    : `/reconciliation/commission/pdf-zip?ids=${[...histSel].join(',')}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reconciliation" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reconciliation</Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <Percent className="size-6 text-primary" /> Commission Settlement
          </h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            Unsettled commission grouped by therapist · semi-monthly · for HR (not posted to ERP)
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shrink-0">
          <button type="button" onClick={() => setTab('generate')} className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'generate' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>Settle Commission</button>
          <button type="button" onClick={() => setTab('history')} className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'history' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>History</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBranchId(b.id)}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-bold transition-colors', b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent')}
          >
            {b.code}
          </button>
        ))}
      </div>

      {tab === 'generate' ? (
        <>
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
                {groups.length} therapist · {grandSessions} session(s) · {peso(grandComm)} commission
              </p>
            </div>
          </Card>

          {groups.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <Percent className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">{loading ? 'Loading…' : 'No unsettled commission for this branch in this range.'}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="sticky top-2 z-20 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allSelected} onChange={toggleAll} />
                  <span className="text-sm font-bold">Select All</span>
                  <span className="text-xs font-medium text-muted-foreground">— pick therapists to close their commission into the period</span>
                </label>
                {selected.size > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{selected.size} therapist · {peso(selTotal)} commission</span>
                    <Button size="sm" onClick={doSettle} disabled={pending}>{pending ? 'Settling…' : `Settle Selected (${selected.size})`}</Button>
                  </div>
                )}
              </div>

              {groups.map((g) => {
                const isOpen = expanded.has(g.therapist_id);
                return (
                  <Card key={g.therapist_id} className="p-0 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                      <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={selected.has(g.therapist_id)} onChange={() => toggleSel(g.therapist_id)} />
                      <button type="button" onClick={() => toggleExp(g.therapist_id)} className="text-muted-foreground hover:text-foreground">
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                      <button type="button" onClick={() => toggleExp(g.therapist_id)} className="flex items-center gap-2 text-left">
                        <span className="font-bold">{g.therapist_name}</span>
                        <span className="text-xs font-medium text-muted-foreground">({g.sessions} session{g.sessions > 1 ? 's' : ''} · {peso(g.gross_cents)} gross)</span>
                      </button>
                      <span className="ml-auto text-base font-extrabold tabular">Commission: {peso(g.commission_cents)}</span>
                    </div>
                    {isOpen && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-32 font-bold">Date</TableHead>
                            <TableHead className="w-44 font-bold">Order No</TableHead>
                            <TableHead className="font-bold pl-6">Service</TableHead>
                            <TableHead className="w-16 font-bold text-right">Mins</TableHead>
                            <TableHead className="w-28 font-bold text-right">Gross</TableHead>
                            <TableHead className="w-20 font-bold text-right">Rate</TableHead>
                            <TableHead className="w-32 font-bold text-right pr-4">Commission</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.items.map((it) => (
                            <TableRow key={it.item_id}>
                              <TableCell className="font-medium tabular text-muted-foreground">{it.service_date}</TableCell>
                              <TableCell className="font-mono font-bold">{it.order_no}</TableCell>
                              <TableCell className="font-medium pl-6">
                                {it.service}
                                {it.warmup && <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">warm-up</span>}
                              </TableCell>
                              <TableCell className="tabular text-right text-muted-foreground">{it.duration_minutes ?? '—'}</TableCell>
                              <TableCell className="tabular text-right text-muted-foreground">{peso(it.gross_cents)}</TableCell>
                              <TableCell className="tabular text-right text-muted-foreground">{(it.rate * 100).toFixed(0)}%</TableCell>
                              <TableCell className="font-bold tabular text-right pr-4">{peso(it.commission_cents)}</TableCell>
                            </TableRow>
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
      ) : (
        <div className="flex flex-col gap-3">
          {/* Filter row — narrow by period (overlap) + status. */}
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
                <Percent className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">No commission periods yet.</p>
              </CardContent>
            </Card>
          ) : filteredHistory.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <Percent className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">No periods match the filters.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Select-all + bulk PDF (1 → PDF, many → ZIP). Void periods excluded. */}
              <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allHistSelected} onChange={toggleAllHist} />
                  <span className="text-sm font-bold">Select all ({selectable.length})</span>
                  <span className="text-xs font-medium text-muted-foreground">— pick settlements to download as PDF / ZIP</span>
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
                {/* table-fixed: column widths are exact, so the nested detail (same
                    fixed right-side widths) lines its Commission up under this one. */}
                <Table className="table-fixed">
                  {/* Explicit Settlement No width so the column doesn't absorb
                      half of the slack — Period takes the rest. */}
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-8" />
                      <TableHead className="w-52 font-bold">Settlement No</TableHead>
                      <TableHead className="w-20 font-bold">Branch</TableHead>
                      <TableHead className="font-bold pl-6">Period</TableHead>
                      <TableHead className="w-40 font-bold">Settle Date</TableHead>
                      <TableHead className="w-20 font-bold text-right">Sessions</TableHead>
                      <TableHead className="w-32 font-bold text-right">Commission</TableHead>
                      <TableHead className="w-24 font-bold pl-6">Status</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistory.map((p) => {
                      const isOpen = histExpanded.has(p.id);
                      return (
                        <Fragment key={p.id}>
                          <TableRow className={cn('cursor-pointer', histSel.has(p.id) && 'bg-primary/5')} onClick={() => setHistExpanded((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}>
                            <TableCell className="text-muted-foreground pr-0">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                            <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                              {p.status !== 'void' && (
                                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={histSel.has(p.id)} onChange={() => toggleHistSel(p.id)} />
                              )}
                            </TableCell>
                            <TableCell className="font-mono font-bold">{p.period_no}</TableCell>
                            <TableCell className="font-mono font-bold">{p.branch_code ?? '—'}</TableCell>
                            <TableCell className="font-medium tabular text-muted-foreground pl-6">{p.period_from} → {p.period_to}</TableCell>
                            <TableCell className="font-medium tabular">{p.confirmed_at ? fmtDateTime(p.confirmed_at) : '—'}</TableCell>
                            <TableCell className="font-bold tabular text-right">{p.total_sessions}</TableCell>
                            <TableCell className="font-bold tabular text-right">{peso(p.total_commission_cents)}</TableCell>
                            <TableCell className="pl-6"><Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'} className="font-bold capitalize">{p.status}</Badge></TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end">
                                {p.status === 'closed' && (
                                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidConfirmId(p.id)} disabled={pending}>Void</Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow>
                              <TableCell colSpan={10} className="bg-muted/20 p-0">
                                {/* Mirrors the parent's right-side widths (Commission w-32,
                                    then w-24 + w-20) so amounts align across both tables.
                                    Mins (w-14) sits between Service and Gross. */}
                                <Table className="table-fixed">
                                  <colgroup>
                                    <col className="w-32" />
                                    <col className="w-48" />
                                    <col />
                                    <col className="w-14" />
                                    <col className="w-28" />
                                    <col className="w-16" />
                                    <col className="w-32" />
                                    <col className="w-24" />
                                    <col className="w-20" />
                                  </colgroup>
                                  <TableBody>
                                    {p.detail.map((g) => {
                                      const initials = g.therapist.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                                      return (
                                      <Fragment key={g.therapist}>
                                        <TableRow className="border-t-2 border-primary/20 bg-primary/[0.07] hover:bg-primary/[0.07]">
                                          <TableCell colSpan={6} className="py-2.5 pl-6">
                                            <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary align-middle">{initials}</span>
                                            <span className="align-middle text-sm font-extrabold text-primary">{g.therapist}</span>
                                            <span className="ml-2 align-middle text-xs font-semibold text-muted-foreground">{g.sessions} session{g.sessions > 1 ? 's' : ''} · {peso(g.gross_cents)} gross</span>
                                          </TableCell>
                                          <TableCell className="py-2.5 font-extrabold tabular text-right text-primary">{peso(g.commission_cents)}</TableCell>
                                          <TableCell className="w-24" />
                                          <TableCell className="w-20" />
                                        </TableRow>
                                        <TableRow className="border-b border-border">
                                          <TableCell className="w-32 pl-12 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Date</TableCell>
                                          <TableCell className="w-44 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Order No</TableCell>
                                          <TableCell className="pl-4 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Service</TableCell>
                                          <TableCell className="w-14 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground text-right">Mins</TableCell>
                                          <TableCell className="w-28 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground text-right">Gross</TableCell>
                                          <TableCell className="w-16 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground text-right">Rate</TableCell>
                                          <TableCell className="w-32 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground text-right">Commission</TableCell>
                                          <TableCell className="w-24" />
                                          <TableCell className="w-20" />
                                        </TableRow>
                                        {g.lines.map((l, i) => (
                                          <TableRow key={`${g.therapist}-${i}`}>
                                            <TableCell className="font-medium tabular text-muted-foreground pl-12">{l.service_date}</TableCell>
                                            <TableCell className="font-mono font-bold">{l.order_no}</TableCell>
                                            <TableCell className="font-medium pl-4">
                                              {l.service}
                                              {l.warmup && <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">warm-up</span>}
                                            </TableCell>
                                            <TableCell className="tabular text-right text-muted-foreground">{l.duration_minutes ?? '—'}</TableCell>
                                            <TableCell className="tabular text-right text-muted-foreground">{peso(l.gross_cents)}</TableCell>
                                            <TableCell className="tabular text-right text-muted-foreground">{(l.rate * 100).toFixed(0)}%</TableCell>
                                            <TableCell className="font-bold tabular text-right">{peso(l.commission_cents)}</TableCell>
                                            <TableCell className="w-24" />
                                            <TableCell className="w-20" />
                                          </TableRow>
                                        ))}
                                      </Fragment>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                  {/* Grand Totals — sum of non-void periods in the current
                      filter window. Sessions aligned under Sessions column,
                      commission under Commission column. */}
                  <TableFooter>
                    <TableRow className="border-t-2 border-border bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={6} className="font-extrabold uppercase text-xs tracking-wider text-muted-foreground pl-4">
                        Grand Totals
                        <span className="ml-2 text-muted-foreground/70 normal-case tracking-normal text-[11px]">
                          ({histGrandCount} period{histGrandCount === 1 ? '' : 's'}{histVoidCount > 0 ? ` · ${histVoidCount} void excluded` : ''})
                        </span>
                      </TableCell>
                      <TableCell className="font-extrabold tabular text-right bg-muted/60">{histGrandSessions}</TableCell>
                      <TableCell className="font-extrabold tabular text-right bg-muted/60">{peso(histGrandCommission)}</TableCell>
                      <TableCell colSpan={2} className="bg-muted/60" />
                    </TableRow>
                  </TableFooter>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}

      <AlertDialog open={!!voidConfirmId} onOpenChange={(o) => { if (!o) setVoidConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this commission period?</AlertDialogTitle>
            <AlertDialogDescription>
              The period is marked void and its commission entries return to the open pool so they can be re-settled. Already-paid commission (handled outside this system) isn't affected here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (voidConfirmId) doVoid(voidConfirmId); setVoidConfirmId(null); }}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Void
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
