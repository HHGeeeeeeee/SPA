-- ===========================================================================
-- Promote business_unit from per-table TEXT to a master table.
--
-- Two patterns coexist:
--   * "applies to" semantics  → junction table (positions, service_categories)
--     One row can apply to many business units.
--   * "lives in" semantics    → single FK (customers, employees, service_items,
--     resources, orders)
--     One row belongs to exactly one business unit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MASTER: business_units
-- ---------------------------------------------------------------------------
CREATE TABLE public.business_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_business_units_updated BEFORE UPDATE ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;

INSERT INTO public.business_units (code, name) VALUES
  ('spa', 'SPA'),
  ('gym', 'Gym');

-- ---------------------------------------------------------------------------
-- JUNCTION: positions ↔ business_units  (multi-unit "applies to")
-- ---------------------------------------------------------------------------
CREATE TABLE public.position_business_units (
  position_id       UUID NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  business_unit_id  UUID NOT NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
  PRIMARY KEY (position_id, business_unit_id)
);
ALTER TABLE public.position_business_units ENABLE ROW LEVEL SECURITY;

-- Backfill: existing TEXT business_unit → junction rows.
-- 'shared' becomes one row per existing business unit; named code becomes one row.
INSERT INTO public.position_business_units (position_id, business_unit_id)
SELECT p.id, b.id
  FROM public.positions p
  JOIN public.business_units b ON b.code = p.business_unit
 WHERE p.business_unit <> 'shared';

INSERT INTO public.position_business_units (position_id, business_unit_id)
SELECT p.id, b.id
  FROM public.positions p
 CROSS JOIN public.business_units b
 WHERE p.business_unit = 'shared';

ALTER TABLE public.positions DROP COLUMN business_unit;

-- ---------------------------------------------------------------------------
-- JUNCTION: service_categories ↔ business_units  (multi-unit "applies to")
-- ---------------------------------------------------------------------------
CREATE TABLE public.service_category_business_units (
  service_category_id  UUID NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  business_unit_id     UUID NOT NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
  PRIMARY KEY (service_category_id, business_unit_id)
);
ALTER TABLE public.service_category_business_units ENABLE ROW LEVEL SECURITY;

INSERT INTO public.service_category_business_units (service_category_id, business_unit_id)
SELECT sc.id, b.id
  FROM public.service_categories sc
  JOIN public.business_units b ON b.code = sc.business_unit
 WHERE sc.business_unit <> 'shared';

INSERT INTO public.service_category_business_units (service_category_id, business_unit_id)
SELECT sc.id, b.id
  FROM public.service_categories sc
 CROSS JOIN public.business_units b
 WHERE sc.business_unit = 'shared';

ALTER TABLE public.service_categories DROP COLUMN business_unit;

-- ---------------------------------------------------------------------------
-- SINGLE FK: customers, employees, service_items, resources, orders
-- TEXT 'spa' / 'gym' / 'shared' → FK to business_units.id.
-- 'shared' rows resolve to the SPA row (best-effort; admins can re-pick).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spa_id UUID := (SELECT id FROM public.business_units WHERE code = 'spa');
BEGIN
  -- customers.primary_business_unit
  ALTER TABLE public.customers ADD COLUMN primary_business_unit_id UUID
    REFERENCES public.business_units(id) ON DELETE SET NULL;
  UPDATE public.customers c
     SET primary_business_unit_id = COALESCE(
       (SELECT id FROM public.business_units WHERE code = c.primary_business_unit),
       spa_id
     );
  ALTER TABLE public.customers DROP COLUMN primary_business_unit;

  -- employees.business_unit
  ALTER TABLE public.employees ADD COLUMN business_unit_id UUID
    REFERENCES public.business_units(id) ON DELETE SET NULL;
  UPDATE public.employees e
     SET business_unit_id = COALESCE(
       (SELECT id FROM public.business_units WHERE code = e.business_unit),
       spa_id
     );
  ALTER TABLE public.employees DROP COLUMN business_unit;

  -- service_items.business_unit
  ALTER TABLE public.service_items ADD COLUMN business_unit_id UUID
    REFERENCES public.business_units(id) ON DELETE SET NULL;
  UPDATE public.service_items si
     SET business_unit_id = COALESCE(
       (SELECT id FROM public.business_units WHERE code = si.business_unit),
       spa_id
     );
  ALTER TABLE public.service_items DROP COLUMN business_unit;

  -- resources.business_unit
  ALTER TABLE public.resources ADD COLUMN business_unit_id UUID
    REFERENCES public.business_units(id) ON DELETE SET NULL;
  UPDATE public.resources r
     SET business_unit_id = COALESCE(
       (SELECT id FROM public.business_units WHERE code = r.business_unit),
       spa_id
     );
  ALTER TABLE public.resources DROP COLUMN business_unit;

  -- orders.business_unit
  ALTER TABLE public.orders ADD COLUMN business_unit_id UUID
    REFERENCES public.business_units(id) ON DELETE SET NULL;
  UPDATE public.orders o
     SET business_unit_id = COALESCE(
       (SELECT id FROM public.business_units WHERE code = o.business_unit),
       spa_id
     );
  ALTER TABLE public.orders DROP COLUMN business_unit;
END $$;
