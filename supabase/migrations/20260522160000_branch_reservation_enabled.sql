-- Per-branch toggle for whether the branch accepts reservations. Defaults to
-- true so existing branches keep booking; turn it off for branches that don't
-- take advance bookings. Only gates new reservations — existing ones are kept.
alter table public.branches
  add column if not exists reservation_enabled boolean not null default true;

comment on column public.branches.reservation_enabled is
  'When false, this branch is hidden from the New Reservation branch picker.';
