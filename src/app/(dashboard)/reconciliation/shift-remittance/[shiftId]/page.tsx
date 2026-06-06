import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, TriangleAlert } from 'lucide-react';

import { currentSession, isManager } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShiftRemittancePanel } from '@/components/reconciliation/shift-remittance-panel';
import { ShiftLinesTabs } from '@/components/reconciliation/shift-lines-tabs';
import { loadShiftDetail, loadRemittanceChecks, type UnsettledOrder } from '../actions';

export const dynamic = 'force-dynamic';

function pesoCur(c: number): string {
  return (c / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
}
function dt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

// Pre-close pipeline check: lists unsettled orders for this shift's branch, or a
// muted "clear" line when there's nothing to action.
function CheckCard({ title, hint, rows }: { title: string; hint: string; rows: UnsettledOrder[] }) {
  const clear = rows.length === 0;
  return (
    <Card className={clear ? 'border-border bg-muted/20' : 'border-destructive bg-destructive/5'}>
      <CardHeader className="pb-2">
        <CardTitle className={`flex items-center gap-2 text-sm font-bold ${clear ? 'text-muted-foreground' : 'text-destructive'}`}>
          {clear ? null : <TriangleAlert className="size-4" />}
          {clear ? `✓ ${title}` : `${rows.length} ${title}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {clear ? (
          <p className="text-xs font-medium text-muted-foreground">{hint}</p>
        ) : (
          <>
            {rows.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/sales-orders/${o.id}`} className="font-bold underline underline-offset-2">{o.orderNo}</Link>
                <span className="text-muted-foreground">Total {pesoCur(o.totalCents)}</span>
                <span className="text-muted-foreground">Paid {pesoCur(o.paidCents)}</span>
                <span className="font-semibold text-destructive">Due {pesoCur(o.totalCents - o.paidCents)}</span>
              </div>
            ))}
            <p className="pt-1 text-xs font-medium text-muted-foreground">{hint}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ShiftDetailPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params;
  const d = await loadShiftDetail(shiftId);
  if (!d) notFound();
  const [session, checks] = await Promise.all([currentSession(), loadRemittanceChecks([d.branchId])]);
  const canReopen = isManager(session);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/reconciliation/shift-remittance" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to shifts
      </Link>

      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-xl font-bold">{d.branchCode} · {d.businessDate} · {d.label}</CardTitle>
            {d.status === 'open'
              ? <Badge variant="outline" className="border-primary/50 font-bold text-primary">Open</Badge>
              : <Badge className="font-bold">Closed</Badge>}
          </div>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">Opened:</span> <span className="text-muted-foreground">{dt(d.openedAt)}{d.openedByName ? ` by ${d.openedByName}` : ''}</span></p>
          {d.status === 'closed' && (
            <p><span className="font-semibold">Closed:</span> <span className="text-muted-foreground">{dt(d.closedAt)}{d.closedByName ? ` by ${d.closedByName}` : ''}</span></p>
          )}
        </CardContent>
      </Card>

      {/* Pre-close pipeline checks for this shift's branch. */}
      <div className="grid gap-3 md:grid-cols-2">
        <CheckCard
          title={`cancelled order${checks.cancelledWithDue.length === 1 ? '' : 's'} with a balance`}
          hint="Cancelled orders that still have charges or payments on record — settle or refund them before closing."
          rows={checks.cancelledWithDue}
        />
        <CheckCard
          title={`unsettled order${checks.dueNotInService.length === 1 ? '' : 's'} not in service`}
          hint="Orders that owe money but have no service running right now — collect or settle them before closing."
          rows={checks.dueNotInService}
        />
      </div>

      {/* Remittance — per-method table (cash counted inline) + summary + close. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold">Remittance</CardTitle>
        </CardHeader>
        <CardContent>
          <ShiftRemittancePanel
            shiftId={d.id}
            label={d.label}
            status={d.status}
            methodRows={d.methodRows}
            cashExpectedCents={d.cashExpectedCents}
            closingCountCents={d.closingCountCents}
            varianceCents={d.varianceCents}
            varianceReason={d.varianceReason}
            canReopen={canReopen}
            revenueByCategory={d.revenueByCategory}
            revenueTotalCents={d.revenueTotalCents}
            paymentsExpectedTotalCents={d.paymentsExpectedTotalCents}
            openingFloatCents={d.openingFloatCents}
            firstOfDay={d.firstOfDay}
          />
        </CardContent>
      </Card>

      {/* Posted revenue / Collected payments — tabbed so the page stays compact. */}
      <Card>
        <CardContent className="pt-6">
          <ShiftLinesTabs revenueLines={d.revenueLines} folioLines={d.folioLines} />
        </CardContent>
      </Card>
    </div>
  );
}