'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  confirmTipSettlement,
  voidTipSettlement,
} from '@/app/(dashboard)/reconciliation/tips/actions';

export function TipSettlementActions({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  if (status !== 'draft') return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={() => startTransition(async () => {
          const r = await confirmTipSettlement(id);
          if (r.ok) toast.success('Settlement confirmed'); else toast.error(r.error);
        })}
        disabled={pending}
      >
        Confirm
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => startTransition(async () => {
          const r = await voidTipSettlement(id);
          if (r.ok) toast.success('Settlement voided'); else toast.error(r.error);
        })}
        disabled={pending}
      >
        Void
      </Button>
    </div>
  );
}
