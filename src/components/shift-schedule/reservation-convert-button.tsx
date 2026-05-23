'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { confirmReservation, convertReservationToOrder } from '@/app/(dashboard)/reservations/actions';

// A reservation block on the Shift Schedule. Clicking opens a dialog: a pending
// reservation can be Confirmed (establishes it; an on-site one then holds its
// bed) or Converted straight to a draft Sales Order; a confirmed one just offers
// Convert.
export function ReservationConvertButton({
  reservationId,
  guest,
  pending = false,
  className,
  style,
  title,
  children,
}: {
  reservationId: string;
  guest: string;
  pending?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();

  function doConfirm() {
    start(async () => {
      const r = await confirmReservation(reservationId);
      if (r.ok) {
        toast.success('Reservation confirmed');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error); // e.g. a pinned bed was taken — keep the dialog open
      }
    });
  }

  function doConvert() {
    start(async () => {
      const r = await convertReservationToOrder(reservationId);
      if (r.ok && r.data) {
        toast.success('Order created from reservation');
        router.push(`/sales-orders/${r.data.orderId}`);
      } else if (!r.ok) {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <button type="button" className={className} style={style} title={title} onClick={() => setOpen(true)}>
        {children}
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending ? 'Pending reservation' : 'Convert reservation to an order?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {guest}
              {pending
                ? ' — Confirm to establish it, or convert straight to a draft Sales Order.'
                : ' — this creates a draft Sales Order (with the guest) and marks the reservation converted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            {pending && (
              <Button variant="outline" disabled={busy} onClick={doConfirm}>
                {busy ? 'Working…' : 'Confirm'}
              </Button>
            )}
            <AlertDialogAction onClick={doConvert} disabled={busy}>
              {busy ? 'Working…' : 'Convert & open'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
