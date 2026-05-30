'use client';

import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { NewReservationDialog } from '@/components/reservations/new-reservation-dialog';
import { MarkFulfilledButton } from '@/components/sales-orders/mark-fulfilled-button';

interface DialogData {
  branches: { id: string; code: string; name: string; businessUnitIds: string[] }[];
  sources: { id: string; code: string; name: string; phone_required: boolean }[];
  serviceCategories: {
    id: string; code: string; name: string; businessUnitIds: string[]; requiredResourceType: string | null;
  }[];
  serviceItems: { id: string; name: string; group: string; categoryId: string; durationMinutes: number | null }[];
}

interface Props extends DialogData {
  itemId: string;
  // Snapshot pulled from the interrupted line — used to pre-fill the
  // NewReservationDialog so the manager only has to pick a date/time.
  prefill: {
    branchId: string;
    sourceId: string | null;
    guestName: string;
    guestPhone: string | null;
    categoryIds: string[];
    serviceItemId: string | null;
  };
  // Banner text rendered inside the dialog ("Order #123 · Pedicure ·
  // interrupted 2026-05-25 (Guest dissatisfaction)").
  summary: string;
}

// Twin actions for a pending reschedule row:
//   1. Create Reservation (primary) — opens the NewReservationDialog
//      pre-filled with the original line's customer / branch / service.
//      Submitting creates a make-up reservation with a back-link FK and
//      auto-clears the pending entry.
//   2. Mark fulfilled (secondary) — for the abandoned case where the
//      customer never came back. No new reservation; just clears pending.
export function RescheduleRowActions({
  itemId,
  prefill,
  summary,
  branches,
  sources,
  serviceCategories,
  serviceItems,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex items-center justify-end gap-2">
      <MarkFulfilledButton itemId={itemId} />
      <NewReservationDialog
        branches={branches}
        sources={sources}
        serviceCategories={serviceCategories}
        serviceItems={serviceItems}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rescheduleFrom={{ itemId, summary }}
        initial={{
          branchId: prefill.branchId,
          sourceId: prefill.sourceId ?? undefined,
          guestName: prefill.guestName,
          guestPhone: prefill.guestPhone,
          categoryIds: prefill.categoryIds,
          serviceItemId: prefill.serviceItemId,
        }}
        trigger={
          <Button size="sm" className="font-semibold">
            <CalendarPlus className="size-3.5" />
            Create reservation
          </Button>
        }
      />
    </div>
  );
}
