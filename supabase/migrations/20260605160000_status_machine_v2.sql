-- Status machine v2 (see docs/status-and-shift-redesign.md).
--
-- order_items: merge unassigned + scheduled into a single 'draft' (bed/therapist
--   assignment is decoupled from status). Keep in_service / service_completed /
--   interrupted / cancelled / no_show.
-- orders: drop the unused 'reserved' / 'posting' and the 'open' step (draft now
--   goes straight to in_service when the first service starts).
--
-- Existing rows are converted in place so the change is non-destructive. Order:
-- drop the CHECK first, then mutate data + default, then add the new CHECK last,
-- so no intermediate statement is validated against a half-converted table.

-- order_items
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
UPDATE public.order_items SET status = 'draft' WHERE status IN ('unassigned', 'scheduled');
ALTER TABLE public.order_items ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('draft', 'in_service', 'service_completed', 'interrupted', 'cancelled', 'no_show'));

-- orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE public.orders SET status = 'draft' WHERE status IN ('open', 'reserved');
UPDATE public.orders SET status = 'completed' WHERE status = 'posting';
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'in_service', 'completed', 'paid', 'closed', 'void'));