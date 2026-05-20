import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Reports"
      description="Operational and financial reports for branches and business units."
      planned={[
        'Daily sales & revenue summary',
        'Therapist commission report',
        'Tip settlement report',
        'Discount / void exception report',
        'AR aging by billing destination',
        'Stored value liability report',
      ]}
    />
  );
}
