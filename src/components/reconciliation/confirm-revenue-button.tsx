'use client';

import { useTransition } from 'react';
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

  function confirm() {
    startTransition(async () => {
      const r = await confirmRevenue({ branch_id: branchId, date });
      if (r.ok) toast.success(`Confirmed — ${r.data?.closed ?? 0} order(s) closed`);
      else toast.error(r.error);
    });
  }

  return (
    <Button onClick={confirm} disabled={pending || disabled || count === 0}>
      {pending ? 'Confirming…' : `Confirm & Close ${count} order(s)`}
    </Button>
  );
}
