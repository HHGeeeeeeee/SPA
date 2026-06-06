-- Transaction-code branch override → free-text Acumatica branch segment.
--
-- The DR/CR "branch (override)" was a UUID FK to branches, so a code could only
-- post to one of the store branches (HSPA1 / HSPA2). Operationally the override
-- needs to name *any* Acumatica branch segment (head office, intercompany, a
-- segment that has no branches row, …), so the column becomes free text holding
-- the branch code directly.
--
-- Existing FK values are converted to their branch code in place; the FK
-- constraints are dropped. The column names keep the historical _id suffix to
-- avoid churn, but they now hold a code string, not a UUID.

ALTER TABLE public.transaction_codes
  DROP CONSTRAINT IF EXISTS transaction_codes_debit_branch_id_fkey,
  DROP CONSTRAINT IF EXISTS transaction_codes_credit_branch_id_fkey;

-- Widen to text (a subquery isn't allowed in a USING transform), then translate
-- the stored UUIDs to their branch code.
ALTER TABLE public.transaction_codes
  ALTER COLUMN debit_branch_id TYPE text USING debit_branch_id::text,
  ALTER COLUMN credit_branch_id TYPE text USING credit_branch_id::text;

UPDATE public.transaction_codes t
  SET debit_branch_id = b.code
  FROM public.branches b
  WHERE b.id::text = t.debit_branch_id;

UPDATE public.transaction_codes t
  SET credit_branch_id = b.code
  FROM public.branches b
  WHERE b.id::text = t.credit_branch_id;