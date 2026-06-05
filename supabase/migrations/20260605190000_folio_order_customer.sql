-- folio_lines needs the guest a payment/refund is tagged to, for the per-guest
-- "Pay separately" split (the old payments table carried order_customer_id).
ALTER TABLE public.folio_lines
  ADD COLUMN order_customer_id UUID REFERENCES public.order_customers(id) ON DELETE SET NULL;
CREATE INDEX idx_folio_lines_customer ON public.folio_lines(order_customer_id);