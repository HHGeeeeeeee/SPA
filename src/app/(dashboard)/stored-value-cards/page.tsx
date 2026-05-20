import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function StoredValueCardsPage() {
  return (
    <ModulePlaceholder
      title="Stored Value Cards"
      description="Prepaid card issuance, top-up, and balance tracking. Cards are a liability, not revenue."
      planned={[
        'Issue / top-up cards tied to a Customer',
        'Balance ledger with expiry handling',
        'Special-discount pricing on issuance',
        'Redemption as a payment method at checkout',
      ]}
    />
  );
}
