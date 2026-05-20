-- ===========================================================================
-- Single source of truth for GL posting is transaction_codes
-- (branch × payment_method × transaction_type → full DR/CR pair).
-- payment_methods carried a duplicate DR/CR block; drop it.
-- ===========================================================================
ALTER TABLE public.payment_methods DROP CONSTRAINT IF EXISTS pm_debit_sub_no_dash;
ALTER TABLE public.payment_methods DROP CONSTRAINT IF EXISTS pm_credit_sub_no_dash;

ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS debit_account;
ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS debit_subaccount;
ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS debit_branch;
ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS credit_account;
ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS credit_subaccount;
ALTER TABLE public.payment_methods DROP COLUMN IF EXISTS credit_branch;
