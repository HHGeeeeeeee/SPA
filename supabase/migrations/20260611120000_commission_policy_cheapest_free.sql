-- A second policy KIND beside the warm-up engine.
--
-- 'warmup'         (existing) — the day's Nth session (by start time) earns a
--                  duration-banded flat rate; everyone else uses the class %.
-- 'cheapest_free'  (new, FIRST60) — each day the therapist's CHEAPEST session
--                  of a target duration earns 0%; every other session uses the
--                  class %. Selection is by price (net paid), not by start time.
--
-- free_duration_minutes pins which sessions are eligible to be the free one:
--   60   → only exactly-60-minute sessions compete; the cheapest is free.
--   NULL → any duration competes (cheapest session of the day is free).
-- Ignored by the 'warmup' kind.
alter table public.commission_policies
  add column if not exists kind text not null default 'warmup';

alter table public.commission_policies
  add column if not exists free_duration_minutes int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'commission_policies_kind_check'
  ) then
    alter table public.commission_policies
      add constraint commission_policies_kind_check
      check (kind in ('warmup', 'cheapest_free'));
  end if;
end $$;

-- FIRST60: each day, the cheapest 60-minute session is free; the rest pay the
-- class %. warmup_enabled off — the warm-up bands don't apply to this kind.
insert into public.commission_policies (code, name, kind, free_duration_minutes, warmup_enabled)
values ('FIRST60', 'First 60-min free (cheapest of the day)', 'cheapest_free', 60, false)
on conflict (code) do nothing;
