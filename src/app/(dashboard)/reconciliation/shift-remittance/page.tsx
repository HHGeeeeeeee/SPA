import Link from 'next/link';

import { getAllowedBranches } from '@/lib/branch-access';
import { currentSession, isManager } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ReconDatePicker } from '@/components/reconciliation/recon-date-picker';
import { ShiftCard } from '@/components/reconciliation/shift-card';
import { loadShiftRemittance } from './actions';

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

  const shifts = branchId ? await loadShiftRemittance(branchId, date) : [];
  const openShift = shifts.find((s) => s.shift?.status === 'open');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Sales Remittance</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Open a shift before taking sales or payments — every posting lands in the open shift. Count and close it at the end.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {branches.map((b) => (
          <Link
            key={b.id}
            href={`/reconciliation/shift-remittance?branch=${b.id}&date=${date}`}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-bold transition-colors', b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent')}
          >
            {b.code}
          </Link>
        ))}
        <div className="ml-auto">
          <ReconDatePicker basePath="/reconciliation/shift-remittance" branchId={branchId} date={date} />
        </div>
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base font-bold">{date}</CardTitle>
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {openShift ? `${openShift.label} open` : 'No shift open'}
            </span>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {shifts.map((s) => (
              <ShiftCard key={s.label} branchId={branchId} date={date} item={s} canReopen={canReopen} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
