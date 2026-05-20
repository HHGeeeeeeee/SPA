import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function RevenueConfirmPage() {
  return (
    <ModulePlaceholder
      title="Revenue Confirm"
      description="The single daily posting node — manually confirm the day's orders into the ERP GL."
      planned={[
        'Review Paid / Completed(AR) orders for the day',
        'Post Revenue Confirm to Acumatica (with tips in the same batch)',
        'posting → Closed state with rollback on failure',
        'ERPPostingLog entry + Retry on failure',
      ]}
    />
  );
}
