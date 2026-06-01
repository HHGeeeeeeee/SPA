-- Manager-PIN approver tracking on the interrupt flow.
--
-- When staff stops a service with handling='no_charge', the system now
-- requires a manager PIN before accepting the call (server-side check,
-- staff can't bypass even via direct API). The approving manager's id is
-- recorded on the order_item so the audit trail says exactly who waived
-- the charge — not just "system did it".
--
-- Column is nullable: legacy rows + handlings other than no_charge + the
-- internal switchService path (which is operational, not a manager
-- decision) all leave this null.

ALTER TABLE order_items
  ADD COLUMN interruption_approved_by_user_id UUID
    REFERENCES staff_users(id) ON DELETE SET NULL;

-- Partial index: only the rows where it's set, used by reports / audit
-- joins that ask "show me everything Manager X approved this month".
CREATE INDEX IF NOT EXISTS idx_order_items_interruption_approver
  ON order_items (interruption_approved_by_user_id, interruption_at)
  WHERE interruption_approved_by_user_id IS NOT NULL;
