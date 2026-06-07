import { fetchBoardDialogData } from '@/lib/board-dialog-data';
import { BookingWorkspace } from '@/components/booking/booking-workspace';
import { loadMyBookings } from './actions';

export const dynamic = 'force-dynamic';

export default async function BookPage() {
  const [dialog, bookings] = await Promise.all([fetchBoardDialogData(), loadMyBookings()]);
  return <BookingWorkspace dialog={dialog} initialBookings={bookings} />;
}