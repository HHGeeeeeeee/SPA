-- Unified service lifecycle: order_items absorbs the reservation's pre-life so a
-- booking and a sales-order service are ONE thing on the calendar (no two
-- transactions fighting over time, no duplicated collision logic).
--
-- New states:
--   unassigned — tentative booking (replaces reservation reserved + confirmed);
--                left rail on the board, not billable
--   no_show    — booked but the guest never came (marked manually by the desk);
--                zero revenue, off-board
-- Retired:
--   feedback_done — feedback is tracked by the feedback row / feedback_score, not
--                   a status. service_completed is the single "delivered" state.
--
-- No data backfill: there is no production order_items data yet.

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('unassigned','scheduled','in_service',
                    'service_completed','interrupted','cancelled','no_show'));

-- New lines start tentative (no bed/therapist, maybe no concrete service yet).
ALTER TABLE public.order_items ALTER COLUMN status SET DEFAULT 'unassigned';

-- "Pick the time + duration now, choose the concrete service later": the concrete
-- service_item and its price are unknown until the guest decides, so they go
-- nullable. Category stays required (NOT NULL, set on booking); duration is
-- always known and now defaults to 60 min when not specified.
ALTER TABLE public.order_items ALTER COLUMN service_item_id  DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN list_price_cents DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN final_amount_cents DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN duration_minutes SET DEFAULT 60;