-- Warm-up bands become a duration RANGE with an ABSOLUTE commission rate.
--   - min_minutes..up_to_minutes (inclusive; NULL = open end) lets a rule lock
--     an exact duration, e.g. 120–120.
--   - commission_rate is the flat rate the warm-up session earns (NOT a
--     multiplier of the class rate). The warm-up is a special override; only
--     the 2nd+ session of the day uses the class rate.
alter table public.commission_policy_bands
  add column if not exists min_minutes int;

alter table public.commission_policy_bands
  rename column rate_multiplier to commission_rate;

-- DEFAULT policy: the old open-ended "50% of class" band becomes a flat 50%
-- locked to exactly 120 minutes. The ≤90 → 0% band is unchanged (open lower).
update public.commission_policy_bands
set up_to_minutes = 120, min_minutes = 120
where up_to_minutes is null;
