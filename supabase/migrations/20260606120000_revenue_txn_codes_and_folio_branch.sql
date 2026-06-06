-- Revenue transaction codes + folio branch/code stamping.
--
-- Three linked changes so every folio posting carries the GL transaction code it
-- belongs to, decided at posting time rather than re-derived at ERP-export:
--
--   1. transaction_codes gains a 'revenue' type. Revenue codes are NOT branch
--      specific — revenue follows the order, not the store — so branch_id
--      becomes optional and is required only for the branch-scoped types
--      (payment / settle / cost / adjust).
--
--   2. service_categories binds to a revenue code (revenue_transaction_code_id).
--      Starting a service posts that category's revenue code onto the folio line.
--
--   3. folio_lines gains branch_id + transaction_code_id, populated at insert.

-- ── 1. transaction_codes: add 'revenue' type, make branch optional for it ────
ALTER TABLE public.transaction_codes
  DROP CONSTRAINT IF EXISTS transaction_codes_transaction_type_check;
ALTER TABLE public.transaction_codes
  ADD CONSTRAINT transaction_codes_transaction_type_check
  CHECK (transaction_type IN ('payment', 'settle', 'cost', 'adjust', 'revenue'));

-- Revenue codes are order-driven, not branch-scoped → branch may be null. Every
-- other type still needs a branch.
ALTER TABLE public.transaction_codes
  ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE public.transaction_codes
  ADD CONSTRAINT transaction_codes_branch_required_unless_revenue
  CHECK (transaction_type = 'revenue' OR branch_id IS NOT NULL);

-- The display-code unique key is (code, branch_id); with a null branch Postgres
-- treats the rows as distinct, so guard branchless (revenue) codes separately.
CREATE UNIQUE INDEX transaction_codes_branchless_code_key
  ON public.transaction_codes (code)
  WHERE branch_id IS NULL;

-- ── 2. service_categories: bind to a revenue code ───────────────────────────
ALTER TABLE public.service_categories
  ADD COLUMN revenue_transaction_code_id UUID REFERENCES public.transaction_codes(id);

-- ── 3. folio_lines: stamp branch + transaction code at posting time ──────────
ALTER TABLE public.folio_lines
  ADD COLUMN branch_id UUID REFERENCES public.branches(id),
  ADD COLUMN transaction_code_id UUID REFERENCES public.transaction_codes(id);
CREATE INDEX idx_folio_lines_branch ON public.folio_lines(branch_id);

-- ── Seed: one branchless service-revenue code (CR services revenue 40140) ────
-- Debit left blank for now — fill in the clearing/AR account via the UI.
INSERT INTO public.transaction_codes (code, branch_id, transaction_type, credit_account, credit_subaccount, active)
VALUES ('REVENUE-SVC', NULL, 'revenue', '40140', '000000000', true)
ON CONFLICT DO NOTHING;
