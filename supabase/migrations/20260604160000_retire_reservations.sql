-- Retire the reservations feature. Bookings are now order_items: a draft order
-- with one unassigned line per guest (createBooking replaces createReservation +
-- convertReservationToOrder). All reservation reads/writes were removed from the
-- app before this migration, so dropping the tables breaks nothing.

-- Stop + drop the stale-reservation cron job and its worker function. Wrapped so
-- it's a no-op if pg_cron / the job isn't present.
DO $$ BEGIN
  PERFORM cron.unschedule('cancel-stale-reservations');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DROP FUNCTION IF EXISTS public.cancel_stale_reservations();

-- Drop the orders → reservations back-link (column + its FK).
ALTER TABLE public.orders DROP COLUMN IF EXISTS reservation_id;

-- Junctions (FK to reservations) first, then the table itself.
DROP TABLE IF EXISTS public.reservation_resources;
DROP TABLE IF EXISTS public.reservation_service_categories;
DROP TABLE IF EXISTS public.reservations;