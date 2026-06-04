-- Per-branch business hours. The shift-schedule board spans open_time..close_time.
-- A close_time at or before open_time means the branch trades past midnight
-- (e.g. 10:00 → 02:00): the after-midnight slots (00:00..close_time) belong to
-- the PREVIOUS calendar day's business day, which is why revenue is keyed on
-- service_date rather than the wall-clock date.
alter table public.branches
  add column if not exists open_time  time not null default '10:00',
  add column if not exists close_time time not null default '02:00';

comment on column public.branches.open_time is
  'Daily opening time (local). Left edge of the shift-schedule board.';
comment on column public.branches.close_time is
  'Daily closing time (local). If <= open_time the branch trades past midnight; '
  'the board extends into the next clock day and 00:00..close_time bookings count '
  'toward the previous business day (service_date).';
