import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function HelpPage() {
  return (
    <ModulePlaceholder
      title="Help"
      description="Operating guides, transaction-code references, and standard procedures for counter staff."
      planned={[
        'Discount code (DIS-xx) cheat sheet',
        'Daily close checklist',
        'Manager-PIN approval scenarios',
        'ERP posting troubleshooting',
      ]}
    />
  );
}
