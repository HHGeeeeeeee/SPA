-- Require a transaction code on every folio posting.
--
-- transaction_code_id was added nullable so the feature could land before codes
-- were configured for every branch. Now it's mandatory: each folio line must
-- carry the GL transaction code it posts under. Enforced as a CHECK ... NOT
-- VALID so the rule binds every future INSERT/UPDATE without a full-table
-- rewrite — any legacy rows are left as-is (they've been backfilled in this env).
ALTER TABLE public.folio_lines
  ADD CONSTRAINT folio_lines_transaction_code_required
  CHECK (transaction_code_id IS NOT NULL) NOT VALID;
