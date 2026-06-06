'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/sales-orders/reason-dialog';
import {
  cancelOrder,
  reopenOrder,
  requestOrderAdjustment,
  setOrderStatus,
} from '@/app/(dashboard)/sales-orders/actions';

interface Props {
  orderId: string;
  status: string;
  canManage: boolean;
  itemCount: number;
  hasPayments: boolean;
}

// The order's primary status-advance action plus Cancel, lifted into the page
// header next to the status badge. Reason-gated transitions keep their dialogs.
export function OrderStatusActions({ orderId, status, canManage, itemCount, hasPayments }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  function doCancel(reason: string) {
    startTransition(async () => {
      const r = await cancelOrder(orderId, reason);
      if (r.ok) { toast.success('Order cancelled'); setCancelOpen(false); router.refresh(); }
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
  function doComplete() {
    startTransition(async () => {
      const r = await setOrderStatus(orderId, 'completed');
      if (r.ok) { toast.success('Order completed'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      {status === 'draft' && (
        <span className="text-xs font-medium text-muted-foreground">Start each service below to begin</span>
      )}
      {status === 'in_service' && (
        <>
          <Button size="sm" onClick={doComplete} disabled={pending}>Complete</Button>
          <span className="text-xs font-medium text-muted-foreground">All services must be finished, skipped, or cancelled first</span>
        </>
      )}
      {status === 'completed' && canManage && (
        <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)} disabled={pending}>Reopen</Button>
      )}
      {status === 'closed' && canManage && (
        <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)} disabled={pending}>Request Adjustment</Button>
      )}
      {!['closed', 'void'].includes(status) && canManage && (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)} disabled={pending}>Cancel</Button>
      )}

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this order?"
        description={
          hasPayments
            ? 'This order has recorded payment(s) — cancelling reverses them and any tips (stored-value redemptions are refunded to the card). A tip that is already settled will block the cancellation. The order is then locked.'
            : 'All scheduled services will be cancelled and the order is locked. Past activity is kept.'
        }
        confirmLabel="Cancel order"
        destructive
        pending={pending}
        onConfirm={doCancel}
      />
      <ReasonDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reopen this order?"
        description="Moves the order back to In Service so it can be edited. Logged for audit."
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
