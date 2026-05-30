'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';

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
import { markRescheduleFulfilled } from '@/app/(dashboard)/sales-orders/actions';

// Manager-only confirm-then-mark for a pending reschedule. Two-step confirm
// mirrors the Void / Refund pattern — clearing a pending reschedule means
// "the customer was made whole", so we want the manager to deliberate it
// rather than accidentally clear with a stray click.
export function MarkFulfilledButton({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    startTransition(async () => {
      const r = await markRescheduleFulfilled(itemId);
      if (r.ok) { toast.success('Marked fulfilled'); setOpen(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" className="font-semibold" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-3.5" />
        Mark fulfilled
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold">Mark this reschedule fulfilled?</AlertDialogTitle>
            <AlertDialogDescription className="font-medium">
              Use this when the guest has come back and the make-up service has been rendered,
              or when the reschedule is being closed out without a make-up. The entry will be
              removed from the pending list — the original interrupted record stays in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={confirm}>
              {pending ? 'Working…' : 'Mark fulfilled'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
