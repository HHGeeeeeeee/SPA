-- Add 'accountant' and 'viewer' to the staff_users.role CHECK constraint.
-- Accountant = staff-level POS access + edit TX codes, payment methods,
-- service categories.
-- Viewer = read-only access with manager-level visibility.
--
-- The inline CHECK from the initial schema may have been auto-named
-- staff_users_role_check or staff_users_role_ch depending on the PG version.
-- Drop whichever exists, then re-add with an explicit name.
DO $$
BEGIN
  -- Try the name Supabase/PG actually gave it (from the error log).
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'staff_users'
      AND constraint_name = 'staff_users_role_ch'
  ) THEN
    ALTER TABLE public.staff_users DROP CONSTRAINT staff_users_role_ch;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'staff_users'
      AND constraint_name = 'staff_users_role_check'
  ) THEN
    ALTER TABLE public.staff_users DROP CONSTRAINT staff_users_role_check;
  END IF;
END
$$;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_ch
      CHECK (role IN ('admin','manager','accountant','staff','viewer','external_booker'));
