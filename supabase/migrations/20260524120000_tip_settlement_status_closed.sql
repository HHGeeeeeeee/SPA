-- tip_settlements used 'posted' in its status check, but the app (confirm
-- action + UI badges/filters) and the sibling settlement tables
-- (cash_reconciliations, revenue_soa) all use 'closed' as the terminal status.
-- Confirming a tip settlement therefore failed the check constraint. Align the
-- constraint to the app vocabulary: draft -> posting -> closed (or failed/void).
ALTER TABLE public.tip_settlements DROP CONSTRAINT IF EXISTS tip_settlements_status_check;
ALTER TABLE public.tip_settlements ADD CONSTRAINT tip_settlements_status_check
  CHECK (status IN ('draft', 'posting', 'closed', 'failed', 'void'));
