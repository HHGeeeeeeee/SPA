-- EOD pipeline reworked so it no longer closes orders itself (that's Revenue
-- Confirm's job, which enforces cash-closed first). Step 1 becomes a pure
-- "Order Review" (cancel no-shows + check the day's orders are all served), so
-- rename the step-1 timestamp accordingly. Revenue Confirmation is detected
-- (all the day's orders closed) rather than stamped here.
ALTER TABLE public.business_day_close RENAME COLUMN revenue_confirmed_at TO order_reviewed_at;
