-- Booking-side intent: a group (pax > 1) that wants to sit together. When set,
-- the system auto-assigns that many adjacent free beds at save time (the booker
-- never picks bed numbers). Singles / groups that don't ask to sit together stay
-- unassigned until check-in. Staff can still override the actual beds.
alter table public.reservations
  add column if not exists seat_together boolean not null default false;
