'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, ChevronRight, ChevronDown, Download, HandCoins, RotateCcw, TriangleAlert } from 'lucide-react';

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
import { loadOpenTipGroups, settleTips, voidTipSettlement, retryTipPosting, type TipGroup } from '@/app/(dashboard)/reconciliation/tips/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', posting: 'secondary', closed: 'default', failed: 'destructive', void: 'destructive',
};

const HIST_STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'posting', label: 'Posting' },
  { value: 'closed', label: 'Closed' },
  { value: 'failed', label: 'Failed' },
  { value: 'void', label: 'Void' },
];

interface Branch { id: string; code: string; name: string }
export interface TipHistoryRow {
  id: string;
  settlement_no: string;
  branch_code: string | null;
  status: string;
  period_from: string;
  period_to: string;
  subtotal_cents: number;
  posted_at: string | null;
  therapists: string[];
  lines: { therapist: string; service_date: string; order_no: string; amount_cents: number }[];
  posting_status: string | null;
  gl_batch_nbr: string | null;
  posting_error: string | null;
}

export function TipSettlementWorkspace({
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
  initialGroups: TipGroup[];
  history: TipHistoryRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'generate' | 'history'>('generate');
  const [branchId, setBranchId] = useState(initialBranchId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [groups, setGroups] = useState<TipGroup[]>(initialGroups);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [histExpanded, setHistExpanded] = useState<Set<string>>(new Set());
  // History filter (date + status) and selection-for-PDF state. Filter is
  // overlap on period_from/to so a settlement is in range if its period
  // intersects the window. Selection always respects the filter — Select all
  // selects only the currently-visible rows.
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
        const data = await loadOpenTipGroups(branchId, from, to);
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
  const selTotal = selGroups.reduce((s, g) => s + g.total_cents, 0);
  const selTipCount = selGroups.reduce((s, g) => s + g.count, 0);

  function doSettle() {
    if (selected.size === 0) return toast.error('Select at least one therapist');
    const tipIds = selGroups.flatMap((g) => g.tips.map((t) => t.id));
    startGen(async () => {
      const r = await settleTips({ branch_id: branchId, tip_ids: tipIds });
      if (r.ok) {
        toast.success(`Settled ${r.data?.count} tip(s)`);
        setSelected(new Set());
        const data = await loadOpenTipGroups(branchId, from, to);
        setGroups(data);
        router.refresh();
        setTab('history');
      } else toast.error(r.error);
    });
  }

  function doVoid(id: string) {
    startGen(async () => {
      const r = await voidTipSettlement(id);
      if (r.ok) { toast.success('Settlement voided'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  function doRetry(id: string) {
    startGen(async () => {
      const r = await retryTipPosting(id);
      if (r.ok) { toast.success('Retried — posted to ERP'); router.refresh(); }
      else { toast.error(r.error); router.refresh(); }
    });
  }

  const grandOpen = groups.reduce((s, g) => s + g.total_cents, 0);
  const grandCount = groups.reduce((s, g) => s + g.count, 0);

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
  // Void rows have no PDF function (settlement was reversed) — they're shown
  // for the audit trail but excluded from selection / Select all.
  const selectable = filteredHistory.filter((s) => s.status !== 'void');
  const allHistSelected = selectable.length > 0 && selectable.every((s) => histSel.has(s.id));
  function toggleHistSel(id: string) {
    setHistSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllHist() {
    setHistSel((prev) => {
      const n = new Set(prev);
      if (allHistSelected) for (const s of selectable) n.delete(s.id);
      else for (const s of selectable) n.add(s.id);
      return n;
    });
  }
  // 1 selected → that settlement's PDF; many → a ZIP of separate PDFs.
  const pdfHref = histSel.size === 1
    ? `/reconciliation/tips/${[...histSel][0]}/pdf`
    : `/reconciliation/tips/pdf-zip?ids=${[...histSel].join(',')}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reconciliation" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reconciliation</Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <HandCoins className="size-6 text-primary" /> Tip Settlement
          </h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            Open PAYMAYA tips, grouped by therapist · settle semi-monthly to AP
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shrink-0">
          <button type="button" onClick={() => setTab('generate')} className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'generate' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>Settle Tips</button>
          <button type="button" onClick={() => setTab('history')} className={cn('rounded-md px-4 py-1.5 text-sm font-bold transition-colors', tab === 'history' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent')}>History</button>
        </div>
      </div>

      {/* branch selector */}
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
                {groups.length} therapist · {grandCount} tip(s) · {peso(grandOpen)}
              </p>
            </div>
          </Card>

          {groups.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <HandCoins className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">{loading ? 'Loading…' : 'No open tips for this branch in this range.'}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="sticky top-2 z-20 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allSelected} onChange={toggleAll} />
                  <span className="text-sm font-bold">Select All</span>
                  <span className="text-xs font-medium text-muted-foreground">— pick therapists' open tips to settle into one AP Bill</span>
                </label>
                {selected.size > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{selected.size} therapist · {selTipCount} tip(s) · {peso(selTotal)}</span>
                    <Button size="sm" onClick={doSettle} disabled={pending}>{pending ? 'Settling…' : `Settle Selected (${selTipCount})`}</Button>
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
                        <span className="text-xs font-medium text-muted-foreground">({g.count} tip{g.count > 1 ? 's' : ''})</span>
                      </button>
                      <span className="ml-auto text-base font-extrabold tabular">Total: {peso(g.total_cents)}</span>
                    </div>
                    {isOpen && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-36 font-bold">Date</TableHead>
                            <TableHead className="font-bold">Order No</TableHead>
                            <TableHead className="w-36 font-bold text-right pr-4">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.tips.map((t) => (
                            <TableRow key={t.id}>
                              <TableCell className="font-medium tabular text-muted-foreground">{t.service_date}</TableCell>
                              <TableCell className="font-mono font-bold">{t.order_no}</TableCell>
                              <TableCell className="font-bold tabular text-right pr-4">{peso(t.amount_cents)}</TableCell>
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
          {/* Filter row — narrow the list by period (overlap) and status.
              Mirrors the SOA / Commission history filter. */}
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
                <HandCoins className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">No settlements yet.</p>
              </CardContent>
            </Card>
          ) : filteredHistory.length === 0 ? (
            <Card className="border-dashed bg-muted/30">
              <CardContent className="py-10 text-center">
                <HandCoins className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-semibold text-muted-foreground mt-3">No settlements match the filters.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Select-all + bulk PDF download (single → PDF, many → ZIP). */}
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
                {/* table-fixed: exact widths so the nested detail's Amount lines up
                    under Total (same w-32 + trailing w-24 + w-20). */}
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-8" />
                      <TableHead className="font-bold">Settlement No</TableHead>
                      <TableHead className="w-16 font-bold">Branch</TableHead>
                      <TableHead className="font-bold pl-6">Period</TableHead>
                      <TableHead className="w-40 font-bold">Settle Date</TableHead>
                      <TableHead className="w-32 font-bold text-right">Total</TableHead>
                      <TableHead className="w-24 font-bold pl-6">Status</TableHead>
                      <TableHead className="w-44 font-bold">ERP</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistory.map((s) => {
                      const isOpen = histExpanded.has(s.id);
                      return (
                        <Fragment key={s.id}>
                          <TableRow className={cn('cursor-pointer', histSel.has(s.id) && 'bg-primary/5')} onClick={() => setHistExpanded((p) => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}>
                            <TableCell className="text-muted-foreground pr-0">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                            <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                              {s.status !== 'void' && (
                                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={histSel.has(s.id)} onChange={() => toggleHistSel(s.id)} />
                              )}
                            </TableCell>
                            <TableCell className="font-mono font-bold">{s.settlement_no}</TableCell>
                            <TableCell className="font-mono font-bold">{s.branch_code ?? '—'}</TableCell>
                            <TableCell className="font-medium tabular text-muted-foreground pl-6">{s.period_from} → {s.period_to}</TableCell>
                            <TableCell className="font-medium tabular">{s.posted_at ? fmtDateTime(s.posted_at) : '—'}</TableCell>
                            <TableCell className="font-bold tabular text-right">{peso(s.subtotal_cents)}</TableCell>
                            <TableCell className="pl-6"><Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="font-bold capitalize">{s.status}</Badge></TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {s.gl_batch_nbr ? (
                                <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-bold text-primary">
                                  <Check className="size-3" /> Bill #{s.gl_batch_nbr}
                                </span>
                              ) : s.posting_status === 'failed' ? (
                                <span className="inline-flex items-center gap-1">
                                  <span title={s.posting_error ?? 'AP posting failed'} className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-bold text-destructive">
                                    <TriangleAlert className="size-3" /> Failed
                                  </span>
                                  <Button size="sm" variant="ghost" onClick={() => doRetry(s.id)} disabled={pending} className="h-7 gap-1 px-2 text-xs">
                                    <RotateCcw className="size-3" /> Retry
                                  </Button>
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end items-center gap-1">
                                {s.status === 'closed' && (
                                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidConfirmId(s.id)} disabled={pending}>Void</Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow>
                              <TableCell colSpan={10} className="bg-muted/20 p-0">
                                {/* Amount + trailing spacers mirror the parent's Total
                                    (w-32) + Status (w-24) + Actions (w-20). */}
                                <Table className="table-fixed">
                                  <colgroup>
                                    <col className="w-44" />
                                    <col className="w-32" />
                                    <col />
                                    <col className="w-32" />
                                    <col className="w-24" />
                                    <col className="w-20" />
                                  </colgroup>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="font-bold pl-12">Therapist</TableHead>
                                      <TableHead className="font-bold">Date</TableHead>
                                      <TableHead className="font-bold">Order No</TableHead>
                                      <TableHead className="font-bold text-right">Amount</TableHead>
                                      <TableHead />
                                      <TableHead />
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {s.lines.map((l, i) => (
                                      <TableRow key={`${s.id}-${i}`}>
                                        <TableCell className="font-medium pl-12">{l.therapist}</TableCell>
                                        <TableCell className="font-medium tabular text-muted-foreground">{l.service_date}</TableCell>
                                        <TableCell className="font-mono font-bold">{l.order_no}</TableCell>
                                        <TableCell className="font-bold tabular text-right">{peso(l.amount_cents)}</TableCell>
                                        <TableCell className="w-24" />
                                        <TableCell className="w-20" />
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
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

      <AlertDialog open={!!voidConfirmId} onOpenChange={(o) => { if (!o) setVoidConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this tip settlement?</AlertDialogTitle>
            <AlertDialogDescription>
              The settlement is marked void and its tips return to the open pool so they can be re-settled. Any ERP posting on this settlement is left intact — reverse it in Acumatica if needed.
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
