import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function ReservationsPage() {
  return (
    <ModulePlaceholder
      title="Reservations"
      description="Booking calendar and reservation management for walk-ins, hotel referrals, and online bookings."
      planned={[
        'Create / modify / cancel reservations',
        'Slot vs service dual-window scheduling against Service Stations',
        'Auto no-show after the configured grace period',
        'Hotel front-desk (external booker) self-service view',
        'Convert a reservation into a Sales Order at check-in',
      ]}
    />
  );
}
