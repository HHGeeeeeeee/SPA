import Link from 'next/link';

import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { currentSession, isAdmin, isManager } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CashReconForm } from '@/components/reconciliation/cash-recon-form';
import { CashShiftConfig } from '@/components/reconciliation/cash-shift-config';
import { ReconDatePicker } from '@/components/reconciliation/recon-date-picker';
import { loadDayShifts, getBranchShifts, getBranchShiftConfig } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function CashReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const session = await currentSession();
  const admin = isAdmin(session);
  const canReopen = isManager(session);
  const branches = await getAllowedBranches();
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id;
  const date = sp.date || todayPHT();

  const shifts = branchId ? await loadDayShifts(branchId, date) : [];
  const configured = branchId ? await getBranchShifts(branchId) : [];
  const shiftConfig = branchId ? await getBranchShiftConfig(branchId) : null;
  const allClosed = shifts.length > 0 && shifts.every((s) => s.closed);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Shift Cash Count</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Count each shift&apos;s drawer before the day&apos;s Revenue Confirm.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {list.map((b) => (
          <Link
            key={b.id}
            href={`/reconciliation/cash?branch=${b.id}&date=${date}`}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-bold transition-colors', b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent')}
          >
            {b.code}
          </Link>
        ))}
        <div className="ml-auto">
          <ReconDatePicker basePath="/reconciliation/cash" branchId={branchId} date={date} />
        </div>
        {branchId && admin && shiftConfig && <CashShiftConfig branchId={branchId} config={shiftConfig} />}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-bold">{date} · {configured.join(' / ')}</CardTitle>
            {allClosed && <span className="text-xs font-bold uppercase tracking-wide text-primary">All shifts closed — Revenue Confirm unlocked</span>}
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {shifts.map((s) => (
              <CashReconForm key={s.label} branchId={branchId} date={date} shift={s} canReopen={canReopen} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
