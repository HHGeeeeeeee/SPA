-- Allow a scheduled service line to be skipped/cancelled (guest decides not to
-- do it). Cancelled lines don't count toward totals and don't block the order
-- from auto-completing.
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('scheduled','in_service','service_completed','interrupted','feedback_done','cancelled'));
