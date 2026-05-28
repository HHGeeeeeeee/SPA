-- Force-close (manager override) for business_day_close.
-- A force-close marks the day as `closed` without going through the normal
-- 4-step EoD pipeline (Review → Balance → Revenue Confirm → Close). It exists
-- for the rare case where the desk forgot to close yesterday and operations
-- are now blocked — the manager fills a reason, the day is sealed, and
-- audit_log gets the record.
--
-- The audit trail is intentionally NOT a soft override: once forced, the row
-- is treated as `closed` by every guard. The reason column is what tells
-- accounting later that this day was not a normal close.

ALTER TABLE public.business_day_close
  ADD COLUMN forced_closed_at TIMESTAMPTZ,
  ADD COLUMN forced_closed_by UUID REFERENCES public.staff_users(id),
  ADD COLUMN forced_close_reason TEXT;

-- If forced, closed_at is also set (to the same timestamp) so existing
-- queries that filter by `status = 'closed'` keep working without changes.
-- That's enforced at the application layer (forceCloseBusinessDay action).

COMMENT ON COLUMN public.business_day_close.forced_closed_at IS
  'Manager override timestamp — set when force-closed without going through the normal EoD pipeline.';
COMMENT ON COLUMN public.business_day_close.forced_closed_by IS
  'Manager who triggered the force-close.';
COMMENT ON COLUMN public.business_day_close.forced_close_reason IS
  'Why the day was force-closed (filled by the manager).';

CREATE INDEX idx_bdc_forced_closed ON public.business_day_close(forced_closed_at) WHERE forced_closed_at IS NOT NULL;
