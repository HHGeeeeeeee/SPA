-- ---------------------------------------------------------------------------
-- MASTER: positions
-- HR job title master data. Doesn't drive business logic (commission via
-- commission_classes, app permissions via staff_users.role) — purely a
-- normalized label for filtering / reporting.
-- ---------------------------------------------------------------------------
CREATE TABLE public.positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  business_unit   TEXT NOT NULL DEFAULT 'spa',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_positions_updated BEFORE UPDATE ON public.positions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

-- Seed default SPA positions
INSERT INTO public.positions (code, name, business_unit) VALUES
  ('MASSAGE_THERAPIST', 'Massage Therapist',  'spa'),
  ('HAIR_STYLIST',     'Hair Stylist',        'spa'),
  ('NAIL_TECHNICIAN',  'Nail Technician',     'spa'),
  ('RECEPTIONIST',     'Receptionist',        'spa'),
  ('STORE_MANAGER',    'Store Manager',       'spa');

-- ---------------------------------------------------------------------------
-- ALTER employees: position TEXT -> position_id FK
-- Backfill existing data by matching name → positions.name; orphans go NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees ADD COLUMN position_id UUID
  REFERENCES public.positions(id) ON DELETE SET NULL;

UPDATE public.employees e
   SET position_id = p.id
  FROM public.positions p
 WHERE p.name = e.position;

ALTER TABLE public.employees DROP COLUMN position;
