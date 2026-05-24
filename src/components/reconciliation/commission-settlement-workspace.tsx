'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, Percent } from 'lucide-react';

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
import { loadCommissionGroups, settleCommission, voidCommissionPeriod, type CommGroup } from '@/app/(dashboard)/reconciliation/commission/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', closed: 'default', void: 'destructive',
};

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
                            <TableHead className="font-bold">Service</TableHead>
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
                              <TableCell className="font-medium">
                                {it.service}
                                {it.warmup && <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">warm-up</span>}
                              </TableCell>
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
      ) : history.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-10 text-center">
            <Percent className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-semibold text-muted-foreground mt-3">No commission periods yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Period No</TableHead>
                <TableHead className="w-20 font-bold">Branch</TableHead>
                <TableHead className="font-bold">Period</TableHead>
                <TableHead className="w-20 font-bold text-right">Sessions</TableHead>
                <TableHead className="w-32 font-bold text-right">Commission</TableHead>
                <TableHead className="w-28 font-bold">Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-bold">{p.period_no}</TableCell>
                  <TableCell className="font-mono font-bold">{p.branch_code ?? '—'}</TableCell>
                  <TableCell className="font-medium tabular text-muted-foreground">{p.period_from} → {p.period_to}</TableCell>
                  <TableCell className="font-bold tabular text-right">{p.total_sessions}</TableCell>
                  <TableCell className="font-bold tabular text-right">{peso(p.total_commission_cents)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'} className="font-bold capitalize">{p.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {p.status === 'closed' && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => doVoid(p.id)} disabled={pending}>Void</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
