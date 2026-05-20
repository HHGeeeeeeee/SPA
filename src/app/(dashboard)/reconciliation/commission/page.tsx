import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function CommissionSettlementPage() {
  return (
    <ModulePlaceholder
      title="Commission Settlement"
      description="Therapist commission calculation and settlement based on gross sales."
      planned={[
        'Commission per Commission Class %',
        'First 60–90 min session at 0%, reset per calendar day',
        'Rest-room time excluded from commission',
        'Settlement run with ERP posting',
      ]}
    />
  );
}
