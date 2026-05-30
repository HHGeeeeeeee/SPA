-- Service-interrupt taxonomy + reschedule tracking.
--
-- Until now order_items.interruption_reason was a single free-text field, which
-- made the "what was the most common reason?" reporting impossible — every reason
-- was a unique narrative. Split into three:
--
--   - interruption_reason_code:  the picked taxonomy value (full_charge_*, no_charge_*,
--                                 reschedule_*) — queryable, comparable across rows
--   - interruption_reason:       human-readable label of the picked code (or 'Other'
--                                 — kept as the legacy display field so existing
--                                 reports and the Change History tab keep working)
--   - interruption_notes:        free-text supplemental notes (optional, but the UI
--                                 makes it required when the picked code is 'Other')
--
-- Reschedule follow-up tracking:
--
--   - reschedule_fulfilled_at:   NULL while a reschedule remains pending follow-up.
--                                 Set to now() when manager marks it fulfilled (the
--                                 customer came back and the make-up service was
--                                 rendered, or the request was abandoned). Powers
--                                 the Pending Reschedules list under Sales Orders.

ALTER TABLE order_items
  ADD COLUMN interruption_reason_code TEXT,
  ADD COLUMN interruption_notes TEXT,
  ADD COLUMN reschedule_fulfilled_at TIMESTAMPTZ;

-- We are NOT adding a CHECK on interruption_reason_code: the taxonomy is owned by
-- the application and we want to be able to evolve it (add/remove options) without
-- a migration round-trip. The handling-CHECK already constrains the high-level
-- billing mode; reason codes are bookkeeping.
--
-- Likewise, partial_charge is staying in the handling CHECK so historical rows
-- (if any) remain valid — only the UI hides it from new interrupts.
