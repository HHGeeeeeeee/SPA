import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function ArBalancePage() {
  return (
    <ModulePlaceholder
      title="AR Balance"
      description="Outstanding accounts receivable by billing destination."
      planned={[
        'AR aging per billing destination',
        'Intercompany vs third-party split',
        'Drill into the orders behind each balance',
      ]}
    />
  );
}
