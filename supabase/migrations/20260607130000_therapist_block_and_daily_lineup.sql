-- Two day-of-operations features for the calendar People board:
--
-- 1. THERAPIST_BLOCK — an intra-day absence on a therapist (late, early-leave,
--    stepped out, AWOL…). A from→to window with a reason. Distinct from
--    employee_shifts.leave (which blanks the WHOLE day at roster time): a block
--    is the live, partial-day reality the front desk records on the fly. A
--    therapist may have several blocks in one day (no unique key).
--    A blocked window drops the therapist off the board's "available" list and
--    rejects assignment during it. Cumulative-absence reports read this table.
--
-- 2. DAILY_LINEUP — the manual "who's next" order the desk re-marks each day.
--    Stored as ONE ordered_ids array per (branch, date): every save overwrites
--    the whole array, so there's no positional-shift arithmetic to get wrong
--    (re-marking = re-storing the lot). Display-only — it drives no assignment
--    or conflict logic, just the order therapists are listed for the desk.

-- ── THERAPIST_BLOCK ─────────────────────────────────────────────────────────
CREATE TABLE public.therapist_block (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES public.employees(id),
  branch_id     UUID NOT NULL REFERENCES public.branches(id),
  block_date    DATE NOT NULL,
  -- Manila wall-clock instants for the absence window, stored as timestamptz
  -- (mirrors order_items.slot_start/end so the board maths is identical).
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  reason        TEXT NOT NULL,
  -- Optional coarse bucket for later reporting ("most absent for X"). Free
  -- reason text stays the human note; this is the rollup key when set.
  block_kind    TEXT CHECK (block_kind IN ('late', 'early_leave', 'stepped_out', 'absent', 'other')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES public.staff_users(id),
  updated_by    UUID REFERENCES public.staff_users(id),
  CHECK (end_at > start_at)
);
CREATE INDEX idx_therapist_block_emp_date ON public.therapist_block(employee_id, block_date);
CREATE INDEX idx_therapist_block_branch_date ON public.therapist_block(branch_id, block_date);
CREATE TRIGGER trg_therapist_block_updated BEFORE UPDATE ON public.therapist_block
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.therapist_block ENABLE ROW LEVEL SECURITY;

-- ── DAILY_LINEUP ────────────────────────────────────────────────────────────
CREATE TABLE public.daily_lineup (
  branch_id     UUID NOT NULL REFERENCES public.branches(id),
  lineup_date   DATE NOT NULL,
  -- The whole order in one row. Overwritten wholesale on every save.
  ordered_ids   UUID[] NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES public.staff_users(id),
  PRIMARY KEY (branch_id, lineup_date)
);
CREATE TRIGGER trg_daily_lineup_updated BEFORE UPDATE ON public.daily_lineup
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.daily_lineup ENABLE ROW LEVEL SECURITY;

-- Audit the absence table (who marked whom absent, when). daily_lineup is a
-- low-stakes display ordering — left out of the audit set to keep it lean.
DROP TRIGGER IF EXISTS zz_audit_trg ON public.therapist_block;
CREATE TRIGGER zz_audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.therapist_block
  FOR EACH ROW EXECUTE FUNCTION public.audit_capture();