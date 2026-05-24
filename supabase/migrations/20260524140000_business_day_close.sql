-- End of Day pipeline: one record per branch + business date. The daily close
-- runs as Revenue Confirmation -> Check Balances -> Close Day; once closed, the
-- branch's day is locked (no new orders / payments for that service_date).
CREATE TABLE public.business_day_close (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id             UUID NOT NULL REFERENCES public.branches(id),
  business_date         DATE NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by             UUID REFERENCES public.staff_users(id),
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  revenue_confirmed_at  TIMESTAMPTZ,
  balances_ok_at        TIMESTAMPTZ,
  closed_by             UUID REFERENCES public.staff_users(id),
  closed_at             TIMESTAMPTZ,
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, business_date)
);
CREATE TRIGGER trg_business_day_close_updated BEFORE UPDATE ON public.business_day_close
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.business_day_close ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_bdc_branch_date ON public.business_day_close(branch_id, business_date);
