import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function TipSettlementPage() {
  return (
    <ModulePlaceholder
      title="Tip Settlement"
      description="Semi-monthly PAYMAYA tip settlement to AP. Cash tips never enter the system."
      planned={[
        'Aggregate PAYMAYA tips per therapist',
        'Settle to AP with ERP posting',
        'posting → Closed with rollback on failure',
      ]}
    />
  );
}
