-- Cleanup after the reservations table was retired (20260604160000). The
-- residual reservation_enabled branch flag and the overdue-grace setting no
-- longer gate anything: bookings are order_items now, the New Reservation
-- branch picker never filtered on the flag, and the overdue concept (which
-- read the grace setting) died with the reservations table. Drop both.
--
-- NOTE: apply this only AFTER the code that selected branches.reservation_enabled
-- has shipped (settings/branches page, reschedules query). Dropping the column
-- while the old deploy is still live would 500 the Branches settings page.

alter table public.branches
  drop column if exists reservation_enabled;

delete from public.settings
  where key = 'reservation_overdue_grace_minutes';
