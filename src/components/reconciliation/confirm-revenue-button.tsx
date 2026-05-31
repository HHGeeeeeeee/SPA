'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { confirmRevenue } from '@/app/(dashboard)/reconciliation/revenue-confirm/actions';

interface Props {
  branchId: string;
  date: string;
  count: number;
  disabled: boolean;
}

export function ConfirmRevenueButton({ branchId, date, count, disabled }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    startTransition(async () => {
      const r = await confirmRevenue({ branch_id: branchId, date });
      if (r.ok) {
        router.refresh();
        const closed = r.data?.closed ?? 0;
        const failed = r.data?.failed ?? 0;
        if (failed > 0) {
          // Partial: some orders posted, others failed and stayed in their
          // prior status. Open the failed orders to retry from the ERP banner.
          toast.error(
            `Closed ${closed} · ${failed} ERP post failed — open the order(s) to retry. (${r.data?.first_error ?? ''})`,
            { duration: 12000 },
          );
        } else {
          // Surface the Acumatica GL batch number when posted — it's what
          // the manager/accountant looks up in the ERP to verify the entry.
          // batchNbr is null in dev mode (ACUMATICA_BASE_URL not set) — in
          // that case the toast just confirms the local close.
          const batchNbr = r.data?.batchNbr;
          toast.success(
            batchNbr
              ? `Confirmed — ${closed} order(s) closed · Batch #${batchNbr}`
              : `Confirmed — ${closed} order(s) closed`,
            { duration: batchNbr ? 8000 : 4000 },
          );
        }
      } else toast.error(r.error);
    });
  }

  return (
    <Button onClick={confirm} disabled={pending || disabled || count === 0}>
      {pending ? 'Confirming…' : `Confirm & Close ${count} order(s)`}
    </Button>
  );
}
