'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Sunset, Scale, Lock, CircleCheck } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  loadEod, runOrderReview, runBalanceCheck, markRevenueConfirmed, closeBusinessDay, type EodView,
} from '@/app/(dashboard)/reconciliation/end-of-day/actions';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function fmt(iso: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

interface Branch { id: string; code: string; name: string }

export function EodPipeline({
  branches,
  initialBranchId,
  initialDate,
  initialView,
}: {
  branches: Branch[];
  initialBranchId: string;
  initialDate: string;
  initialView: EodView;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(initialBranchId);
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<EodView>(initialView);
  const [loading, startLoad] = useTransition();
  const [pending, startStep] = useTransition();

  const [firstRun, setFirstRun] = useState(true);
  useEffect(() => {
    if (firstRun) { setFirstRun(false); return; }
    if (!branchId || !date) return;
    const t = setTimeout(() => { startLoad(async () => setView(await loadEod(branchId, date))); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, date]);

  const rec = view.record;
  const step1Done = !!rec?.order_reviewed_at;
  const step2Done = !!rec?.balances_ok_at;
  const step3Done = !!rec?.revenue_confirmed_at; // manually acknowledged after all orders are closed
  const closed = rec?.status === 'closed';
  const eodNo = `EOD-${date.replaceAll('-', '').slice(2)}`;

  function run(fn: (b: string, d: string) => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startStep(async () => {
      const r = await fn(branchId, date);
      if (r.ok) { toast.success(okMsg); setView(await loadEod(branchId, date)); router.refresh(); }
      else toast.error(r.error ?? 'Failed');
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/reconciliation" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reconciliation</Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <Sunset className="size-6 text-primary" /> End of Day
          </h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">Close the branch&apos;s day: confirm revenue, check balances, then lock.</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Business Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
      </div>

      {/* branch selector */}
      <div className="flex flex-wrap items-center gap-2">
        {branches.map((b) => (
          <button key={b.id} type="button" onClick={() => setBranchId(b.id)}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-bold transition-colors', b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent')}>
            {b.code}
          </button>
        ))}
      </div>

      {/* status banner */}
      <Card className={cn('border', closed ? 'border-primary/40 bg-primary/5' : 'border-blue-500/40 bg-blue-500/5')}>
        <CardContent className="py-3 flex items-center gap-2 text-sm font-semibold">
          {closed ? <Lock className="size-4 text-primary" /> : <Sunset className="size-4 text-blue-600" />}
          <span className="font-bold">{eodNo} — {closed ? 'CLOSED' : rec ? 'OPEN' : 'NOT STARTED'}</span>
          {rec && (
            <span className="text-muted-foreground font-medium">
              {closed
                ? `Closed by ${rec.closed_by_name ?? '—'} at ${rec.closed_at ? fmt(rec.closed_at) : '—'}`
                : `Opened by ${rec.opened_by_name ?? '—'} at ${fmt(rec.opened_at)}`}
            </span>
          )}
          {loading && <span className="text-xs text-muted-foreground">· loading…</span>}
        </CardContent>
      </Card>

      {/* 4-step pipeline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Step 1 — Order Review */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StepDot n={1} done={step1Done} active={!closed && !step1Done} />
            <h3 className="text-lg font-bold">Order Review</h3>
          </div>
          <p className="text-sm font-medium text-muted-foreground flex-1">
            Cancel no-show reservations and check every order has been served (none left draft / open / in service).
            {view.noShowCount > 0 && <span className="block mt-1 text-amber-700 dark:text-amber-400">{view.noShowCount} no-show reservation(s) will be cancelled.</span>}
            {view.unserved.length > 0 && <span className="block mt-1 text-amber-700 dark:text-amber-400">{view.unserved.length} order(s) not finished: {view.unserved.slice(0, 3).map((b) => `${b.order_no}(${b.status})`).join(', ')}{view.unserved.length > 3 ? '…' : ''}</span>}
          </p>
          {step1Done ? (
            <div className="flex items-center gap-1.5 text-sm font-bold text-primary"><CircleCheck className="size-4" /> Reviewed {rec?.order_reviewed_at ? `· ${fmt(rec.order_reviewed_at)}` : ''}</div>
          ) : (
            <Button onClick={() => run(runOrderReview, 'Orders reviewed')} disabled={pending || closed}>{pending ? '…' : 'Run Order Review'}</Button>
          )}
        </Card>

        {/* Step 2 — Check Balances */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StepDot n={2} done={step2Done} active={!closed && step1Done && !step2Done} />
            <h3 className="text-lg font-bold">Check Balances</h3>
          </div>
          <p className="text-sm font-medium text-muted-foreground flex-1">
            Ensure every non-AR order for this day is fully settled (outstanding = 0).
            {view.nonArOutstandingCount > 0 && <span className="block mt-1 text-amber-700 dark:text-amber-400">{view.nonArOutstandingCount} unpaid · {peso(view.nonArOutstandingCents)} outstanding.</span>}
          </p>
          {step2Done ? (
            <div className="flex items-center gap-1.5 text-sm font-bold text-primary"><CircleCheck className="size-4" /> Balanced {rec?.balances_ok_at ? `· ${fmt(rec.balances_ok_at)}` : ''}</div>
          ) : step1Done ? (
            <Button onClick={() => run(runBalanceCheck, 'Balances OK')} disabled={pending || closed}>{pending ? '…' : 'Run Balance Check'}</Button>
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">Complete Step 1 first.</p>
          )}
        </Card>

        {/* Step 3 — Revenue Confirmation (handled on its own page) */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StepDot n={3} done={step3Done} active={!closed && step2Done && !step3Done} />
            <h3 className="text-lg font-bold">Revenue Confirmation</h3>
          </div>
          <p className="text-sm font-medium text-muted-foreground flex-1">
            Close the day&apos;s Paid / AR-completed orders on the Revenue Confirm page (cash must be reconciled first).
            {view.pendingConfirmCount > 0 && <span className="block mt-1 text-amber-700 dark:text-amber-400">{view.pendingConfirmCount} order(s) still to confirm.</span>}
            {view.pendingConfirmCount > 0 && !view.cashClosed && <span className="block mt-1 text-amber-700 dark:text-amber-400">Cash not closed yet — Revenue Confirm will be blocked.</span>}
          </p>
          {step3Done ? (
            <div className="flex items-center gap-1.5 text-sm font-bold text-primary"><CircleCheck className="size-4" /> Confirmed {rec?.revenue_confirmed_at ? `· ${fmt(rec.revenue_confirmed_at)}` : ''}</div>
          ) : step2Done ? (
            <div className="flex flex-col gap-2">
              <Link href={`/reconciliation/revenue-confirm?branch=${branchId}&date=${date}`} className={buttonVariants({ variant: 'outline' })}>
                Go to Revenue Confirm
              </Link>
              <Button onClick={() => run(markRevenueConfirmed, 'Revenue confirmed')} disabled={pending || view.pendingConfirmCount > 0}>
                {pending ? '…' : view.pendingConfirmCount > 0 ? `${view.pendingConfirmCount} still to confirm` : 'Confirm Revenue'}
              </Button>
            </div>
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">Complete Step 2 first.</p>
          )}
        </Card>

        {/* Step 4 — Close Day */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StepDot n={4} done={closed} active={!closed && step1Done && step2Done && step3Done} />
            <h3 className="text-lg font-bold">Close Day</h3>
          </div>
          <p className="text-sm font-medium text-muted-foreground flex-1">
            Lock the day. Afterwards no new orders or payments can post to this date (ERP export can run safely).
          </p>
          {closed ? (
            <div className="flex items-center gap-1.5 text-sm font-bold text-primary"><Lock className="size-4" /> Day closed</div>
          ) : step1Done && step2Done && step3Done ? (
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => run(closeBusinessDay, 'Business day closed')} disabled={pending}>
              <Lock className="size-4" /> {pending ? '…' : 'Close Business Day'}
            </Button>
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">Complete Steps 1–3 first.</p>
          )}
        </Card>
      </div>

      {/* EOD Sales Summary */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <Scale className="size-4 text-muted-foreground" />
          <h3 className="text-base font-bold">EOD Sales Summary</h3>
          <span className="ml-auto text-sm font-semibold text-muted-foreground">{date}</span>
        </div>
        <div className="divide-y divide-border">
          <SummarySection title="Revenue" rows={view.revenue} total={view.revenueTotalCents} tone="revenue" />
          <SummarySection title="Payment / Refund" rows={view.payments} total={view.paymentTotalCents} tone="payment" />
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-extrabold">Grand Total</span>
            <span className="font-extrabold tabular">{peso(view.revenueTotalCents + view.paymentTotalCents)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StepDot({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span className={cn(
      'inline-flex size-7 items-center justify-center rounded-full text-sm font-bold',
      done ? 'bg-primary text-primary-foreground' : active ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground',
    )}>
      {done ? <CircleCheck className="size-4" /> : n}
    </span>
  );
}

function SummarySection({ title, rows, total, tone }: { title: string; rows: { label: string; amount_cents: number }[]; total: number; tone: 'revenue' | 'payment' }) {
  const accent = tone === 'revenue' ? 'text-blue-700 dark:text-blue-400' : 'text-primary';
  return (
    <div>
      <div className={cn('px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide', accent)}>{title}</div>
      {rows.length === 0 ? (
        <div className="px-4 pb-2 text-sm font-medium text-muted-foreground">—</div>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-1.5 text-sm">
            <span className="font-semibold">{r.label}</span>
            <span className="font-bold tabular">{peso(r.amount_cents)}</span>
          </div>
        ))
      )}
      <div className={cn('flex items-center justify-between px-4 py-2 text-sm font-bold', accent)}>
        <span>{title} Subtotal</span>
        <span className="tabular">{peso(total)}</span>
      </div>
    </div>
  );
}
