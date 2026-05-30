-- Back-link a reservation to the interrupted order_item it's compensating
-- for. Created by the Pending Reschedules flow: when a manager rebooks a
-- customer whose previous service was interrupted with handling=reschedule,
-- the new reservation gets this FK pointing back at the original line.
--
-- Why a FK and not just a free-text note: queries like "how many bookings
-- this month are make-ups vs net new" need the relationship to be
-- structured, and the reservation detail UI can show a clickable banner
-- ("Rescheduled from Order #123 — original interrupt 2026-05-25") instead of
-- a fragile string. The legacy `note` field is left alone for narrative.
--
-- ON DELETE SET NULL: if the original order_item is ever hard-deleted (rare
-- — most flows soft-delete), the reservation survives without the broken
-- back-link rather than cascading.

ALTER TABLE reservations
  ADD COLUMN rescheduled_from_order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL;

-- Index because the Pending Reschedules flow + future reports both filter on
-- this column ("show me all reservations originating from a reschedule").
CREATE INDEX IF NOT EXISTS idx_reservations_rescheduled_from
  ON reservations (rescheduled_from_order_item_id)
  WHERE rescheduled_from_order_item_id IS NOT NULL;
