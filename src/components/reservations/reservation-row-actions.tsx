'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Check, X, CalendarX, ArrowRightCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  setReservationStatus,
  convertReservationToOrder,
} from '@/app/(dashboard)/reservations/actions';

interface Props {
  reservation: { id: string; status: string };
}

export function ReservationRowActions({ reservation }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { id, status } = reservation;
  const terminal = ['converted', 'cancelled', 'no_show'].includes(status);

  function set(next: 'confirmed' | 'cancelled' | 'no_show') {
    startTransition(async () => {
      const r = await setReservationStatus(id, next);
      if (r.ok) toast.success(`Marked ${next.replace('_', ' ')}`);
      else toast.error(r.error);
    });
  }

  function convert() {
    startTransition(async () => {
      const r = await convertReservationToOrder(id);
      if (r.ok && r.data) { toast.success('Converted to order'); router.push(`/sales-orders/${r.data.orderId}`); }
      else if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" disabled={pending}>
              <MoreVertical className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {!terminal && (
            <DropdownMenuItem onClick={convert}>
              <ArrowRightCircle className="size-4" />
              Convert to Order
            </DropdownMenuItem>
          )}
          {status === 'reserved' && (
            <DropdownMenuItem onClick={() => set('confirmed')}>
              <Check className="size-4" />
              Confirm
            </DropdownMenuItem>
          )}
          {!terminal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => set('no_show')}>
                <CalendarX className="size-4" />
                Mark No-show
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => set('cancelled')}>
                <X className="size-4" />
                Cancel
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
