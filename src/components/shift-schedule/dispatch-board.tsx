'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hotel, MapPin, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NewReservationDialog, type ReservationItem } from '@/components/reservations/new-reservation-dialog';
import type { BoardDialogData } from '@/components/shift-schedule/schedule-board';

export interface DispatchRow {
  id: string;
  guest_name: string;
  guest_phone: string | null;
  pax: number;
  source_code: string | null;
  external_room_no: string | null;
  desired_service_start: string;
  desired_service_end: string;
  status: string;
  note: string | null;
  service_categories: string;
  editData: ReservationItem;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  reserved: 'secondary', confirmed: 'default', cancelled: 'destructive',
};

/**
 * Dispatch board — list view for external (hotel-dispatched) reservations.
 *
 * Distinct from Station / Therapist: external bookings never sit on a bed and
 * the therapist travels to the hotel room, so a time-axis board adds little
 * value. A list focused on "who, where, when" is the right shape for the
 * dispatcher coordinating travel + arrival at the room.
 *
 * Rows are clickable → open NewReservationDialog in edit mode. If the
 * dispatcher edits the reservation back to On-site, it disappears from this
 * view and reappears in the Station "To place" lane (the location-type flip
 * is the single source of truth).
 */
export function DispatchBoard({
  day,
  rows,
  dialog,
}: {
  day: string;
  rows: DispatchRow[];
  dialog: BoardDialogData;
}) {
  const router = useRouter();
  const [editRes, setEditRes] = useState<ReservationItem | null>(null);

  if (rows.length === 0) {
    return (
      <Card className="border-dashed bg-muted/30 p-10 flex flex-col items-center gap-2 text-center">
        <Hotel className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-semibold text-muted-foreground">No external (hotel) dispatches for {day}.</p>
        <p className="text-xs font-medium text-muted-foreground/80">
          External bookings appear here when a reservation is created with Location = External (hotel room).
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 font-bold">Time</TableHead>
              <TableHead className="font-bold">Guest</TableHead>
              <TableHead className="w-12 font-bold text-center">PAX</TableHead>
              <TableHead className="w-32 font-bold">Hotel</TableHead>
              <TableHead className="w-24 font-bold">Room</TableHead>
              <TableHead className="font-bold">Service</TableHead>
              <TableHead className="w-24 font-bold text-center">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setEditRes(r.editData)}>
                <TableCell className="font-bold tabular">
                  {hhmm(r.desired_service_start)}<span className="text-muted-foreground"> – </span>{hhmm(r.desired_service_end)}
                </TableCell>
                <TableCell>
                  <div className="font-bold">{r.guest_name}</div>
                  {r.guest_phone && <div className="text-xs font-medium text-muted-foreground">{r.guest_phone}</div>}
                </TableCell>
                <TableCell className="font-bold tabular text-center">{r.pax}</TableCell>
                <TableCell className="font-mono font-bold">
                  {r.source_code ? (
                    <span className="inline-flex items-center gap-1">
                      <Hotel className="size-3.5 text-muted-foreground" />
                      {r.source_code}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono font-bold">
                  {r.external_room_no ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5 text-muted-foreground" />
                      {r.external_room_no}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">no room</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{r.service_categories || '—'}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'} className="font-bold capitalize">{r.status}</Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" onClick={() => setEditRes(r.editData)}>
                    Edit <ChevronRight className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {editRes && (
        <NewReservationDialog
          key={editRes.id}
          mode="edit"
          branches={dialog.branches}
          sources={dialog.sources}
          serviceCategories={dialog.serviceCategories}
          serviceItems={dialog.serviceItems}
          reservation={editRes}
          open
          onOpenChange={(o) => { if (!o) { setEditRes(null); router.refresh(); } }}
        />
      )}
    </>
  );
}
