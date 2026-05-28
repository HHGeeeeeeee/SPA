'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/sales-orders/reason-dialog';
import {
  setOrderStatus,
  voidOrder,
  reopenOrder,
  requestOrderAdjustment,
} from '@/app/(dashboard)/sales-orders/actions';

interface Props {
  orderId: string;
  status: string;
  canManage: boolean;
  itemCount: number;
  hasPayments: boolean;
}

// The order's primary status-advance action plus Void, lifted into the page
// header next to the status badge. Reason-gated transitions keep their dialogs.
export function OrderStatusActions({ orderId, status, canManage, itemCount, hasPayments }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  function doStatus(next: string) {
    startTransition(async () => {
      const r = await setOrderStatus(orderId, next);
      if (r.ok) { toast.success(`Order ${next.replace('_', ' ')}`); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function doVoid(reason: string) {
    startTransition(async () => {
      const r = await voidOrder(orderId, reason);
      if (r.ok) { toast.success('Order voided'); setVoidOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function doReopen(reason: string) {
    startTransition(async () => {
      const r = await reopenOrder(orderId, reason);
      if (r.ok) { toast.success('Order reopened'); setReopenOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }
  function doAdjust(reason: string) {
    startTransition(async () => {
      const r = await requestOrderAdjustment(orderId, reason);
      if (r.ok) { toast.success('Adjustment requested'); setAdjustOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      {status === 'draft' && (
        <Button size="sm" onClick={() => doStatus('open')} disabled={pending || itemCount === 0}>Open Order</Button>
      )}
      {status === 'open' && (
        <span className="text-xs font-medium text-muted-foreground">Start each service below to begin</span>
      )}
      {status === 'in_service' && (
        <span className="text-xs font-medium text-muted-foreground">Completes when every service is finished or skipped</span>
      )}
      {status === 'paid' && (
        <span className="text-xs font-medium text-muted-foreground">Paid — closes at daily Revenue Confirm</span>
      )}
      {status === 'completed' && canManage && (
        <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)} disabled={pending}>Reopen</Button>
      )}
      {status === 'closed' && canManage && (
        <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)} disabled={pending}>Request Adjustment</Button>
      )}
      {!['closed', 'void'].includes(status) && canManage && (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)} disabled={pending}>Void</Button>
      )}

      <ReasonDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this order?"
        description={
          hasPayments
            ? 'This order has recorded payment(s) — voiding reverses them and any tips (stored-value redemptions are refunded to the card). A tip that is already settled will block the void. The order is then locked.'
            : 'The order is cancelled and locked. Past activity is kept.'
        }
        confirmLabel="Void order"
        destructive
        pending={pending}
        onConfirm={doVoid}
      />
      <ReasonDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reopen this order?"
        description="Moves the order back to Open so it can be edited. Logged for audit."
        confirmLabel="Reopen"
        pending={pending}
        onConfirm={doReopen}
      />
      <ReasonDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        title="Request adjustment?"
        description="Closed orders are corrected via an adjustment (reversal journal posts in the ERP phase)."
        confirmLabel="Request adjustment"
        pending={pending}
        onConfirm={doAdjust}
      />
    </>
  );
}
