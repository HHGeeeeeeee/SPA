-- Collapse to a single folio ledger: retire the payments table. Every money
-- movement is now a folio_lines row (kind = revenue / payment / refund / tip).
-- See docs/status-and-shift-redesign.md.
--
-- The two tables that referenced payments are repointed at folio_lines:
--   tips.payment_id            -> tips.folio_line_id (the kind=tip line)
--   stored_value_transactions.related_payment_id -> related_folio_line_id
-- All four tables are empty, so no data migration is needed.

ALTER TABLE public.tips DROP CONSTRAINT IF EXISTS tips_payment_id_fkey;
ALTER TABLE public.tips RENAME COLUMN payment_id TO folio_line_id;
ALTER TABLE public.tips
  ADD CONSTRAINT tips_folio_line_id_fkey
  FOREIGN KEY (folio_line_id) REFERENCES public.folio_lines(id) ON DELETE CASCADE;

ALTER TABLE public.stored_value_transactions DROP CONSTRAINT IF EXISTS stored_value_transactions_related_payment_id_fkey;
ALTER TABLE public.stored_value_transactions RENAME COLUMN related_payment_id TO related_folio_line_id;
ALTER TABLE public.stored_value_transactions
  ADD CONSTRAINT stored_value_transactions_related_folio_line_id_fkey
  FOREIGN KEY (related_folio_line_id) REFERENCES public.folio_lines(id) ON DELETE SET NULL;

DROP TABLE public.payments;