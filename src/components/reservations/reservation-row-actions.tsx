'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Check, X, CalendarX, ArrowRightCircle, Pencil, RotateCcw } from 'lucide-react';
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
  confirmReservation,
  convertReservationToOrder,
} from '@/app/(dashboard)/reservations/actions';
import { NewReservationDialog, type ReservationItem } from './new-reservation-dialog';

interface SourceOpt { id: string; code: string; name: string; phone_required: boolean }
interface BranchOpt { id: string; code: string; name: string; businessUnitIds: string[] }
interface CategoryOpt { id: string; code: string; name: string; businessUnitIds: string[]; requiredResourceType: string | null }

interface Props {
  reservation: ReservationItem & { status: string };
  branches: BranchOpt[];
  sources: SourceOpt[];
  serviceCategories: CategoryOpt[];
}

export function ReservationRowActions({ reservation, branches, sources, serviceCategories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const { id, status } = reservation;
  const terminal = ['converted', 'cancelled', 'no_show'].includes(status);
  // Cancelled / no-show can still be reopened; everything non-terminal has
  // Edit/Convert/etc. Converted has nothing — hide the menu so it doesn't open
  // an empty popup.
  const hasActions = !terminal || status === 'no_show' || status === 'cancelled';
  if (!hasActions) return null;

  function set(next: 'reserved' | 'cancelled' | 'no_show') {
    startTransition(async () => {
      const r = await setReservationStatus(id, next);
      if (r.ok) { toast.success(next === 'reserved' ? 'Reopened' : `Marked ${next.replace('_', ' ')}`); router.refresh(); }
      else toast.error(r.error);
    });
  }

  // Confirm establishes the booking (an on-site one then holds its bed); it can
  // fail if a pinned bed was taken since, so surface the error.
  function confirm() {
    startTransition(async () => {
      const r = await confirmReservation(id);
      if (r.ok) { toast.success('Reservation confirmed'); router.refresh(); }
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
          {/* A mistaken No-show / Cancel can be reopened back to reserved.
              Converted stays terminal — it already became an order. */}
          {(status === 'no_show' || status === 'cancelled') && (
            <DropdownMenuItem onClick={() => set('reserved')}>
              <RotateCcw className="size-4" />
              Reopen
            </DropdownMenuItem>
          )}
          {!terminal && (
            <DropdownMenuItem onClick={() => setTimeout(() => setEditOpen(true))}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
          )}
          {!terminal && (
            <DropdownMenuItem onClick={convert}>
              <ArrowRightCircle className="size-4" />
              Convert to Order
            </DropdownMenuItem>
          )}
          {status === 'reserved' && (
            <DropdownMenuItem onClick={confirm}>
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

      {/* Mount only while open, keyed by id, so the form always initializes from
          the current reservation (avoids stale pax/beds after an edit elsewhere). */}
      {!terminal && editOpen && (
        <NewReservationDialog
          key={id}
          mode="edit"
          reservation={reservation}
          branches={branches}
          sources={sources}
          serviceCategories={serviceCategories}
          open
          onOpenChange={setEditOpen}
        />
      )}
    </div>
  );
}
