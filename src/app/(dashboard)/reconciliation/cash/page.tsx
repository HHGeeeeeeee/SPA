import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function CashReconciliationPage() {
  return (
    <ModulePlaceholder
      title="Cash Reconciliation"
      description="End-of-day cash drawer count and variance approval."
      planned={[
        'Counted vs expected cash by branch/day',
        'Variance flagging and manager approval',
        'Locks the day once reconciled',
      ]}
    />
  );
}
