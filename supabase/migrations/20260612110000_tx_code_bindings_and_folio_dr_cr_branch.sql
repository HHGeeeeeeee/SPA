-- Transaction-code binding refactor (docs/transaction-code-refactor-plan.md):
--
--   1. branches gain three default code bindings: revenue (manual Add revenue /
--      Adjust charge), tip, and royal (stored-value) card.
--   2. folio_lines gain dr_branch / cr_branch — the Acumatica branch segment for
--      each side of the posting, decided AT TRANSACTION TIME. By Sales
--      Remittance every line already knows its full DR branch/acct/sub and CR
--      branch/acct/sub (accounts from the code, branches from the line).
--   3. payment_methods gain transaction_code_id — the method binds its code
--      (binding direction reversed; codes no longer carry a payment method).
--   4. transaction_codes lose payment_method_id, and the type set shrinks to
--      revenue / payment / tip (settle / cost / adjust were never resolved at
--      runtime).

-- ── 1. branches: default code bindings ──────────────────────────────────────
ALTER TABLE public.branches
  ADD COLUMN default_revenue_transaction_code_id UUID REFERENCES public.transaction_codes(id),
  ADD COLUMN default_tip_transaction_code_id UUID REFERENCES public.transaction_codes(id),
  ADD COLUMN royal_card_transaction_code_id UUID REFERENCES public.transaction_codes(id);

-- ── 2. folio_lines: per-line DR/CR branch segment (free text, like the code
--       overrides — a leg can post to a segment with no branches row) ─────────
ALTER TABLE public.folio_lines
  ADD COLUMN dr_branch TEXT,
  ADD COLUMN cr_branch TEXT;

-- Backfill existing lines: both legs = the shift's branch code (what the old
-- aggregation used as fallback, so posted history is unchanged).
UPDATE public.folio_lines fl
SET dr_branch = b.code,
    cr_branch = b.code
FROM public.shifts s
JOIN public.branches b ON b.id = s.branch_id
WHERE s.id = fl.shift_id
  AND fl.dr_branch IS NULL;

-- ── 3. payment_methods: bound payment code ──────────────────────────────────
ALTER TABLE public.payment_methods
  ADD COLUMN transaction_code_id UUID REFERENCES public.transaction_codes(id);

-- ── 4. transaction_codes: retype + rebind + shrink type set ─────────────────
-- The type check must go first: 'tip' isn't in the old allowed set.
ALTER TABLE public.transaction_codes
  DROP CONSTRAINT IF EXISTS transaction_codes_transaction_type_check;

-- The old tip hack stored tip codes as type 'payment' disambiguated by
-- CR 20500 (tips payable). Promote them to the real 'tip' type.
UPDATE public.transaction_codes
SET transaction_type = 'tip'
WHERE transaction_type = 'payment'
  AND credit_account = '20500';

-- Reverse the method binding while payment_method_id still exists: each method
-- takes its (branch-preferring, then global) active payment code.
UPDATE public.payment_methods pm
SET transaction_code_id = (
  SELECT tc.id FROM public.transaction_codes tc
  WHERE tc.payment_method_id = pm.id
    AND tc.transaction_type = 'payment'
    AND tc.active
  ORDER BY tc.branch_id NULLS LAST, tc.code
  LIMIT 1
);

-- Branch defaults (best-effort from existing rows; adjust via Settings →
-- Branches afterwards).
UPDATE public.branches b
SET default_revenue_transaction_code_id = (
      SELECT tc.id FROM public.transaction_codes tc
      WHERE tc.transaction_type = 'revenue' AND tc.active
        AND (tc.branch_id = b.id OR tc.branch_id IS NULL)
      ORDER BY tc.branch_id NULLS LAST, tc.code LIMIT 1),
    default_tip_transaction_code_id = (
      SELECT tc.id FROM public.transaction_codes tc
      WHERE tc.transaction_type = 'tip' AND tc.active
        AND (tc.branch_id = b.id OR tc.branch_id IS NULL)
      ORDER BY tc.branch_id NULLS LAST, tc.code LIMIT 1),
    royal_card_transaction_code_id = (
      SELECT tc.id FROM public.transaction_codes tc
      JOIN public.payment_methods pm ON pm.id = tc.payment_method_id
      WHERE pm.code = 'stored_value_card'
        AND tc.transaction_type = 'payment' AND tc.active
        AND (tc.branch_id = b.id OR tc.branch_id IS NULL)
      ORDER BY tc.branch_id NULLS LAST, tc.code LIMIT 1);

-- Legacy settle / cost / adjust codes: keep (as 'payment') only if something
-- still references them; delete the rest — they were dead configuration.
UPDATE public.transaction_codes tc
SET transaction_type = 'payment'
WHERE tc.transaction_type IN ('settle', 'cost', 'adjust')
  AND (
    EXISTS (SELECT 1 FROM public.folio_lines fl WHERE fl.transaction_code_id = tc.id)
    OR EXISTS (SELECT 1 FROM public.billing_destinations bd WHERE bd.transaction_code_id = tc.id)
    OR EXISTS (SELECT 1 FROM public.service_categories sc WHERE sc.revenue_transaction_code_id = tc.id)
  );

DELETE FROM public.transaction_codes
WHERE transaction_type IN ('settle', 'cost', 'adjust');

ALTER TABLE public.transaction_codes
  ADD CONSTRAINT transaction_codes_transaction_type_check
  CHECK (transaction_type IN ('revenue', 'payment', 'tip'));

-- Drop the method binding (its partial unique index goes with the column).
ALTER TABLE public.transaction_codes
  DROP COLUMN payment_method_id;
