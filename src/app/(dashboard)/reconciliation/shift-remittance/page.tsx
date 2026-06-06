import { getAllowedBranches } from '@/lib/branch-access';
import { Card } from '@/components/ui/card';
import { ShiftRemittanceList } from '@/components/reconciliation/shift-remittance-list';
import { loadAllShifts, loadShiftLabelOptions } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function ShiftRemittancePage() {
  const branches = (await getAllowedBranches()) ?? [];
  const branchIds = branches.map((b) => b.id);
  const today = todayPHT();

  const [items, shiftOptions] = branchIds.length
    ? await Promise.all([loadAllShifts(branchIds), loadShiftLabelOptions(branchIds)])
    : [[], []];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Sales Remittance</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Open a shift before taking sales or payments — every posting lands in the open shift. Count and close it at the end.
        </p>
      </div>

      {branchIds.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : (
        <ShiftRemittanceList
          items={items}
          branches={branches}
          shiftOptions={shiftOptions}
          today={today}
        />
      )}
    </div>
  );
}
