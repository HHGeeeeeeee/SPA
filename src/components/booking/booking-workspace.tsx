'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Ban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { CreateOrderDialog } from '@/components/sales-orders/create-order-dialog';
import type { BoardDialogData } from '@/components/shift-schedule/schedule-board';
import { loadMyBookings, cancelOwnBooking, type MyBookingRow } from '@/app/(booking)/book/actions';

// Booker-facing status labels (no money / posting detail).
const STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  draft: { label: 'Booked', variant: 'secondary' },
  in_service: { label: 'In service', variant: 'default' },
  completed: { label: 'Completed', variant: 'default' },
  closed: { label: 'Done', variant: 'default' },
  void: { label: 'Cancelled', variant: 'destructive' },
};

export function BookingWorkspace({ dialog, initialBookings }: { dialog: BoardDialogData; initialBookings: MyBookingRow[] }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [pending, start] = useTransition();

  function refresh() {
    start(async () => setBookings(await loadMyBookings()));
  }
  function cancel(id: string) {
    start(async () => {
      const r = await cancelOwnBooking(id);
      if (r.ok) { toast.success('Booking cancelled'); setBookings(await loadMyBookings()); }
      else toast.error(r.error ?? 'Could not cancel');
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            Create a reservation and track the ones you&apos;ve made.
          </p>
        </div>
        <CreateOrderDialog
          dialog={dialog}
          onCreated={() => { toast.success('Booking created'); refresh(); }}
          trigger={<Button><CalendarPlus className="size-4" /> New Booking</Button>}
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <h3 className="text-base font-bold">My Bookings</h3>
          <span className="ml-auto text-sm font-semibold text-muted-foreground">{bookings.length} booking(s)</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Booking #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No bookings yet — tap New Booking to make one.</TableCell></TableRow>
            ) : (
              bookings.map((b) => {
                const s = STATUS[b.status] ?? { label: b.status, variant: 'secondary' as const };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-semibold">{b.order_no}</TableCell>
                    <TableCell>{b.service_date}</TableCell>
                    <TableCell>{b.guest_name ?? '—'}{b.pax > 1 ? ` +${b.pax - 1}` : ''}</TableCell>
                    <TableCell>{b.services.length ? b.services.join(', ') : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{b.branch_code}</TableCell>
                    <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                    <TableCell className="text-right">
                      {b.cancellable && (
                        <Button variant="ghost" onClick={() => cancel(b.id)} disabled={pending} className="gap-1.5 text-destructive hover:text-destructive">
                          <Ban className="size-4" /> Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}