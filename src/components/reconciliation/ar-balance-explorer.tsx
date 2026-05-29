'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronRight, ChevronDown, FilePlus2, Wallet, AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SoaActions } from '@/components/reconciliation/soa-actions';
import { SoaPaymentsList } from '@/components/reconciliation/soa-payments-list';
import { StatusBadge } from '@/components/reconciliation/status-badge';
import { settleSOABatch, type ArBalance, type ArDebtor } from '@/app/(dashboard)/reconciliation/soa/actions';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function fmtDate(ymd: string | null): string {
  if (!ymd) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}
// SOA status badge variants + tooltips live in `status-badge.tsx`.

/**
 * AR Balance — receivables ledger. Headline outstanding split Current / Overdue,
 * then debtors grouped by settlement type: third-party (real cash to collect —
 * the "how much isn't collected" answer) vs intercompany (pending internal
 * cost-transfer settle). Expand a debtor to act on its open statements.
 * Reads from open SOA outstanding + un-stated closed AR; collection still happens
 * on the SOA (Record Payment / Settle) — this view is the ledger, not a new ledger.
 */
export function ArBalanceExplorer({ ar }: { ar: ArBalance }) {
  const router = useRouter();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openSoa, setOpenSoa] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [settling, startSettle] = useTransition();
  const toggle = (id: string) =>
    setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSoa = (id: string) =>
    setOpenSoa((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSel = (id: string) =>
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  function doSettle() {
    const ids = [...sel];
    if (!ids.length) return;
    startSettle(async () => {
      const r = await settleSOABatch(ids);
      if (r.ok) {
        const count = r.data?.settled ?? 0;
        const batches = r.data?.batchNbrs ?? [];
        const batchTag = batches.length === 1 ? ` · GL #${batches[0]}` : batches.length > 1 ? ` · ${batches.length} journals` : '';
        toast.success(`Settled ${count} SOA${count > 1 ? 's' : ''}${batchTag}`);
        setSel(new Set());
        router.refresh();
      } else toast.error(r.error);
    });
  }

  if (ar.debtors.length === 0) {
    return (
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-10 text-center">
          <Wallet className="size-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-semibold text-muted-foreground mt-3">Nothing outstanding — all receivables are collected.</p>
        </CardContent>
      </Card>
    );
  }

  const thirdParty = ar.debtors.filter((d) => d.settlement_type === 'third_party');
  const intercompany = ar.debtors.filter((d) => d.settlement_type === 'intercompany');

  // Bulk settle is intercompany-only (third-party collects per Record Payment).
  // We surface this at page level via a sticky bar that mirrors the SOA / Tip /
  // Commission workspaces — one place for "select all + action", no per-section
  // checkbox cluttering the headers.
  const interCoSoas = intercompany.flatMap((d) => d.soas);
  const interCoIds = interCoSoas.map((s) => s.id);
  const allIntercoSel = interCoIds.length > 0 && interCoIds.every((id) => sel.has(id));
  const selectedTotal = interCoSoas.filter((s) => sel.has(s.id)).reduce((sum, s) => sum + s.outstanding_cents, 0);
  function toggleAllInterco() {
    setSel((p) => {
      const n = new Set(p);
      if (allIntercoSel) interCoIds.forEach((id) => n.delete(id));
      else interCoIds.forEach((id) => n.add(id));
      return n;
    });
  }

  function section(title: string, hint: string, debtors: ArDebtor[], settleable = false, selectBar?: React.ReactNode) {
    if (debtors.length === 0) return null;
    const subUnbilled = debtors.reduce((s, d) => s + d.unbilled_cents, 0);
    const subOutstanding = debtors.reduce((s, d) => s + d.outstanding_cents, 0);
    const subTotal = debtors.reduce((s, d) => s + d.total_cents, 0);
    return (
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
          <p className="text-xs font-medium text-muted-foreground/80">{hint}</p>
        </div>
        {selectBar}
        <Card className="p-0 overflow-hidden">
          <Table className="table-fixed">
            <colgroup>
              <col className="w-8" />
              <col />
              <col className="w-32" />
              <col className="w-32" />
              <col className="w-36" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="font-bold">Billing</TableHead>
                <TableHead className="font-bold text-right">Unbilled</TableHead>
                <TableHead className="font-bold text-right">Outstanding</TableHead>
                <TableHead className="font-bold text-right pr-4">Total Owed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debtors.map((d) => {
                const isOpen = open.has(d.billing_id);
                return (
                  <Fragment key={d.billing_id}>
                    <TableRow className={cn('cursor-pointer', isOpen && 'bg-primary/5')} onClick={() => toggle(d.billing_id)}>
                      <TableCell className="pr-0">
                        {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold">{d.code}</span>
                        <span className="ml-2 text-sm text-muted-foreground">{d.name}</span>
                      </TableCell>
                      <TableCell className="tabular text-right text-muted-foreground">{d.unbilled_cents > 0 ? peso(d.unbilled_cents) : '—'}</TableCell>
                      <TableCell className="tabular text-right">{d.outstanding_cents > 0 ? peso(d.outstanding_cents) : '—'}</TableCell>
                      <TableCell className="tabular text-right font-extrabold pr-4">{peso(d.total_cents)}</TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={5} className="p-0">
                          <div className="px-6 py-3 flex flex-col gap-2">
                            {d.unbilled_count > 0 && (
                              <div className="flex items-center gap-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                                <FilePlus2 className="size-3.5 shrink-0" />
                                {d.unbilled_count} closed order{d.unbilled_count > 1 ? 's' : ''} · {peso(d.unbilled_cents)} not yet on a statement — generate an SOA to bill.
                              </div>
                            )}
                            {d.soas.length === 0 ? (
                              <p className="text-xs font-semibold text-muted-foreground">No open statements.</p>
                            ) : (
                              <Table className="table-fixed">
                                {/* Total / Paid columns inserted between Due and
                                    Outstanding so the desk sees the whole picture
                                    on a partial_paid row: original amount, what's
                                    been collected so far, what's still open.
                                    Paid = total - outstanding (derived; payment
                                    detail still expands below). */}
                                <colgroup>
                                  <col className="w-10" />
                                  <col className="w-64" />
                                  <col className="w-40" />
                                  <col className="w-24" />
                                  <col className="w-28" />
                                  <col className="w-28" />
                                  <col className="w-28" />
                                  <col className="w-28" />
                                  <col className="w-32" />
                                </colgroup>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead />
                                    <TableHead className="font-bold">SOA No</TableHead>
                                    <TableHead className="font-bold">Period</TableHead>
                                    <TableHead className="font-bold">Due</TableHead>
                                    <TableHead className="font-bold text-right">Total</TableHead>
                                    <TableHead className="font-bold text-right">Paid</TableHead>
                                    <TableHead className="font-bold text-right">Outstanding</TableHead>
                                    <TableHead className="font-bold text-center">Status</TableHead>
                                    <TableHead className="pr-4" />
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {d.soas.map((s) => (
                                    <Fragment key={s.id}>
                                    <TableRow>
                                      <TableCell className="pl-4 pr-0">
                                        {settleable && (
                                          <input
                                            type="checkbox"
                                            className="size-4 cursor-pointer accent-primary"
                                            checked={sel.has(s.id)}
                                            onChange={() => toggleSel(s.id)}
                                          />
                                        )}
                                      </TableCell>
                                      <TableCell className="font-mono font-bold">
                                        {s.status === 'partial_paid' && (
                                          <button type="button" onClick={() => toggleSoa(s.id)} className="mr-1 align-middle text-muted-foreground hover:text-foreground" aria-label="Show payments">
                                            {openSoa.has(s.id) ? <ChevronDown className="size-3 inline" /> : <ChevronRight className="size-3 inline" />}
                                          </button>
                                        )}
                                        {s.soa_no}
                                      </TableCell>
                                      <TableCell className="tabular text-muted-foreground text-sm">{s.period_from} → {s.period_to}</TableCell>
                                      <TableCell className="text-sm">
                                        <span className={cn('font-medium', s.days_overdue > 0 ? 'text-destructive' : 'text-muted-foreground')}>{fmtDate(s.due_date)}</span>
                                        {s.days_overdue > 0 && (
                                          <Badge variant="destructive" className="ml-2 font-bold gap-1">
                                            <AlertTriangle className="size-3" />{s.days_overdue}d
                                          </Badge>
                                        )}
                                      </TableCell>
                                      <TableCell className="tabular text-right text-muted-foreground">{peso(s.total_cents)}</TableCell>
                                      <TableCell className="tabular text-right">{s.total_cents - s.outstanding_cents > 0 ? peso(s.total_cents - s.outstanding_cents) : '—'}</TableCell>
                                      <TableCell className="tabular text-right font-bold">{peso(s.outstanding_cents)}</TableCell>
                                      <TableCell className="text-center"><StatusBadge status={s.status} kind="soa" /></TableCell>
                                      <TableCell className="pr-4">
                                        <div className="flex items-center justify-end gap-2">
                                          <SoaActions id={s.id} status={s.status} settlementType={s.settlement_type} outstandingCents={s.outstanding_cents} allowVoid={false} />
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                    {openSoa.has(s.id) && (
                                      <TableRow>
                                        <TableCell colSpan={9} className="bg-muted/20 p-3">
                                          <SoaPaymentsList soaId={s.id} />
                                        </TableCell>
                                      </TableRow>
                                    )}
                                    </Fragment>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
            {/* Section subtotal — sums Unbilled / Outstanding / Total Owed
                across debtors in this settlement-type group. Sits at the
                bottom (replaces the previous right-of-title number) so it
                aligns visually under the numeric columns. */}
            <TableFooter>
              <TableRow className="border-t-2 border-border bg-muted/50 hover:bg-muted/50">
                <TableCell className="bg-muted/60" />
                <TableCell className="font-extrabold uppercase text-xs tracking-wider text-muted-foreground bg-muted/60">
                  Subtotal
                </TableCell>
                <TableCell className="font-extrabold tabular text-right bg-muted/60">{subUnbilled > 0 ? peso(subUnbilled) : '—'}</TableCell>
                <TableCell className="font-extrabold tabular text-right bg-muted/60">{subOutstanding > 0 ? peso(subOutstanding) : '—'}</TableCell>
                <TableCell className="font-extrabold tabular text-right pr-4 bg-muted/60">{peso(subTotal)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total Outstanding</p>
          <p className="text-2xl font-extrabold tabular mt-1">{peso(ar.total_cents)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current</p>
          <p className="text-2xl font-extrabold tabular mt-1">{peso(ar.current_cents)}</p>
        </Card>
        <Card className={cn('p-4', ar.overdue_cents > 0 && 'border-destructive/40 bg-destructive/5')}>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            {ar.overdue_cents > 0 && <AlertTriangle className="size-3.5 text-destructive" />} Overdue
          </p>
          <p className={cn('text-2xl font-extrabold tabular mt-1', ar.overdue_cents > 0 && 'text-destructive')}>{peso(ar.overdue_cents)}</p>
        </Card>
      </div>
      <p className="text-xs font-medium text-muted-foreground -mt-2">
        As of {fmtDate(ar.today)} · &quot;Overdue&quot; = third-party statements past their due date. Intercompany has no due date (settled by internal cost transfer).
      </p>

      {section('Third-party — to collect', 'Real receivables — collected via Record Payment (e.g. Elnido Go pays periodically).', thirdParty)}

      {/* Select-all bar lives INSIDE the Intercompany section (between the
          title and the table) so it visually belongs to the section it acts
          on — previously it sat above the section title and read as a
          stray Third-party control. */}
      {section(
        'Intercompany — to settle',
        'Cleared by internal cost transfer (Settle), not cash collection.',
        intercompany,
        true,
        interCoIds.length > 0 ? (
          <div className="sticky top-2 z-20 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="size-4 cursor-pointer accent-primary"
                checked={allIntercoSel}
                onChange={toggleAllInterco}
              />
              <span className="text-sm font-bold">Select all ({interCoIds.length})</span>
              <span className="text-xs font-medium text-muted-foreground">— pick intercompany statements to batch settle</span>
            </label>
            {sel.size > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold">{sel.size} selected · {peso(selectedTotal)}</span>
                <Button size="sm" onClick={doSettle} disabled={settling}>
                  {settling ? 'Settling…' : `Settle & post (${sel.size})`}
                </Button>
              </div>
            )}
          </div>
        ) : undefined,
      )}
    </div>
  );
}
