-- Transaction code branch becomes fully optional.
--
-- First step of the tx-code globalisation (docs/transaction-code-refactor-plan.md):
-- codes are heading toward being global master data, so the "every non-revenue
-- code must carry a branch" rule goes. A code with branch_id NULL is global;
-- the posting branch is decided at transaction time (the shift's branch).
ALTER TABLE public.transaction_codes
  DROP CONSTRAINT IF EXISTS transaction_codes_branch_required_unless_revenue;
