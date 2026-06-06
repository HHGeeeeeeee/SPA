import { getAllowedBranches } from '@/lib/branch-access';
import { currentSession, isManager } from '@/lib/auth';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReconDatePicker } from '@/components/reconciliation/recon-date-picker';
import { ShiftCard } from '@/components/reconciliation/shift-card';
import { OpenShiftControl } from '@/components/reconciliation/open-shift-control';
import { RemittanceBranchPicker } from '@/components/reconciliation/remittance-branch-picker';
import { loadShiftRemittance, loadCancelledWithDue } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function ShiftRemittancePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const session = await currentSession();
  const canReopen = isManager(session);
  const branches = (await getAllowedBranches()) ?? [];
  const branchId = sp.branch && branches.some((b) => b.id === sp.branch) ? sp.branch : branches[0]?.id;
  const date = sp.date || todayPHT();

  const [shifts, cancelledDue] = branchId
    ? await Promise.all([loadShiftRemittance(branchId, date), loadCancelledWithDue(branchId, date)])
    : [[], []];
  const openShift = shifts.find((s) => s.shift?.status === 'open');
  // Only shifts actually opened (open or closed) get a card. The rest are just
  // choices in the "Open shift" picker — we don't pre-list empty shift cards.
  const opened = shifts.filter((s) => s.shift);
  const availableLabels = shifts.filter((s) => !s.shift).map((s) => s.label);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Sales Remittance</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Open a shift before taking sales or payments — every posting lands in the open shift. Count and close it at the end.
        </p>
      </div>

      {branchId && <RemittanceBranchPicker branches={branches} branchId={branchId} date={date} />}

      <div className="flex items-center justify-end">
        <ReconDatePicker basePath="/reconciliation/shift-remittance" branchId={branchId} date={date} />
      </div>

      {cancelledDue.length > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-destructive flex items-center gap-2">
              <TriangleAlert className="size-4" />
              {cancelledDue.length} cancelled order{cancelledDue.length > 1 ? 's' : ''} with outstanding balance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {cancelledDue.map((o) => (
              <div key={o.id} className="flex items-center gap-3 text-sm">
                <Link href={`/sales-orders/${o.id}`} className="font-bold underline underline-offset-2">{o.order_no}</Link>
                <span className="text-muted-foreground">Total {(o.totalCents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</span>
                <span className="text-muted-foreground">Paid {(o.paidCents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}</span>
              </div>
            ))}
            <p className="text-xs font-medium text-muted-foreground pt-1">
              These orders are cancelled but still have charges or payments on record. Please settle or refund them.
            </p>
          </CardContent>
        </Card>
      )}

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-bold">{date}</CardTitle>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {openShift ? `${openShift.label} open` : 'No shift open'}
              </span>
              {/* One open action — pick AM / PM / GY in the dialog. Hidden while a
                  shift is already open (only one at a time). */}
              {!openShift && <OpenShiftControl branchId={branchId} date={date} labels={availableLabels} />}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {opened.length === 0 ? (
              <p className="col-span-full py-6 text-center text-sm font-medium text-muted-foreground">
                No shift opened yet today. Click “Open shift” to start one.
              </p>
            ) : (
              opened.map((s) => (
                <ShiftCard key={s.label} branchId={branchId} date={date} item={s} canReopen={canReopen} />
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
