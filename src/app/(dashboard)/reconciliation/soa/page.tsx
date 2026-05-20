import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function RevenueSoaPage() {
  return (
    <ModulePlaceholder
      title="Revenue SOA"
      description="Statement of Account generation and settlement for AR billing destinations."
      planned={[
        'Generate monthly SOA per billing destination',
        'Intercompany (50170 / per-hotel sub) vs third-party settle',
        'Issued → settling → Settled with rollback on failure',
        'Cross-month correction handling',
      ]}
    />
  );
}
