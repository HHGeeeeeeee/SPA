-- Step 3 (Revenue Confirmation) now requires an explicit acknowledgement in the
-- EOD pipeline rather than auto-passing, so it needs its own timestamp distinct
-- from Step 1's order_reviewed_at.
ALTER TABLE public.business_day_close ADD COLUMN revenue_confirmed_at TIMESTAMPTZ;
