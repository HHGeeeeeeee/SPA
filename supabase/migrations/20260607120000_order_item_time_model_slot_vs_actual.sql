-- Order-item time model cleanup.
--
-- The four time concepts are now cleanly separated:
--   * scheduled_start  = plan start (booking time)
--   * plan end         = scheduled_start + duration_minutes (derived, no column)
--   * actual_start     = REAL "Start" button press
--   * actual_end       = REAL "End" / interrupt button press
--   * slot_start/end   = the calendar's display block: opens at the planned start
--                        (a late Start press never shifts it) and ends at the
--                        trimmed/capped time stamped on Finish (early finish
--                        shortens it; a late finish is held at the plan end).
--
-- service_start / service_end were redundant mirrors of actual_start/_end:
-- service_end was never read anywhere, and service_start only appeared as a
-- fallback for the planned start (which scheduled_start already covers). Drop them.

-- 1) Backfill slot_* for already-started lines so the calendar (which now reads
--    slot_*) keeps rendering exactly as before. Historical actual_* held the old
--    "display window" semantics (start = scheduled, end = capped), so copying
--    them into slot_* preserves the existing blocks. The genuine button-press
--    times for past services are unrecoverable — only new services record them.
update order_items
set
  slot_start = coalesce(slot_start, actual_start, scheduled_start),
  slot_end = coalesce(
    slot_end,
    actual_end,
    case
      when coalesce(actual_start, scheduled_start) is not null and duration_minutes is not null
        then coalesce(actual_start, scheduled_start) + make_interval(mins => duration_minutes)
    end
  )
where status in ('in_service', 'service_completed', 'interrupted');

-- 2) Drop the redundant columns.
alter table order_items
  drop column if exists service_start,
  drop column if exists service_end;