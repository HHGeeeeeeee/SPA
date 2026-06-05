-- Foundation for "every posting has a home": a real cash SHIFT entity, and a
-- FOLIO_LINES ledger where each posting (revenue when a service starts, plus
-- every payment/refund/tip) is one row bound to the shift it was posted in.
--
-- This migration is purely additive and behaviour-neutral: nothing writes or
-- reads these tables yet. The write paths (takePayment → payment line, Start →
-- revenue line) and the open-shift guard come in later steps. The existing
-- `cash_reconciliations` + `payments` tables keep working until then and retire
-- once the new paths are live.
--
-- See docs/status-and-shift-redesign.md for the full plan.

-- ── SHIFTS ────────────────────────────────────────────────────────────────
-- One row per branch + business_date + shift label, created when a cashier
-- opens the shift. The closing count/variance (today in cash_reconciliations)
-- folds in here so the shift is the single source of truth.
CREATE TABLE public.shifts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id             UUID NOT NULL REFERENCES public.branches(id),
  business_date         DATE NOT NULL,
  label                 TEXT NOT NULL,            -- shift name from cash_shift_config
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by             UUID REFERENCES public.staff_users(id),
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by             UUID REFERENCES public.staff_users(id),
  closed_at             TIMESTAMPTZ,
  opening_float_cents   INTEGER NOT NULL DEFAULT 0,
  -- Filled at close (the drawer count).
  closing_count_cents   INTEGER,
  variance_cents        INTEGER,
  variance_reason       TEXT,
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, business_date, label)
);
CREATE INDEX idx_shifts_branch_date ON public.shifts(branch_id, business_date);
-- At most one OPEN shift per branch at a time, so "the current open shift" a
-- posting binds to is unambiguous.
CREATE UNIQUE INDEX uq_shifts_one_open_per_branch
  ON public.shifts(branch_id) WHERE status = 'open';
CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- ── FOLIO_LINES ───────────────────────────────────────────────────────────
-- The order's running ledger. Every posting is one line bound to the shift it
-- landed in. `kind` decides which side-columns apply:
--   revenue → order_item_id (the service that produced it)
--   payment / refund / tip → payment-method detail (migrated off `payments`)
CREATE TABLE public.folio_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  shift_id              UUID NOT NULL REFERENCES public.shifts(id),
  kind                  TEXT NOT NULL CHECK (kind IN ('revenue', 'payment', 'refund', 'tip')),
  amount_cents          INTEGER NOT NULL,
  posted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by             UUID REFERENCES public.staff_users(id),
  -- kind = revenue
  order_item_id         UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
  -- kind = payment / refund / tip (payment detail, folded in from `payments`)
  payment_method_id     UUID REFERENCES public.payment_methods(id),
  card_last4            TEXT,
  auth_code             TEXT,
  payment_ref           TEXT,
  stored_value_card_id  UUID REFERENCES public.stored_value_cards(id),
  tip_cents             INTEGER,
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_folio_lines_order ON public.folio_lines(order_id);
CREATE INDEX idx_folio_lines_shift ON public.folio_lines(shift_id);
CREATE TRIGGER trg_folio_lines_updated BEFORE UPDATE ON public.folio_lines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.folio_lines ENABLE ROW LEVEL SECURITY;
