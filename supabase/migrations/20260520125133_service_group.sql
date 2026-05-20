-- ===========================================================================
-- "Same service, different duration" grouping. Each duration stays its own
-- priced service_item row, but they share a service_group so the order picker
-- can do "pick service → pick duration".
-- Backfill: strip a trailing " NNmin" from the name (e.g. "Rest Room 60min" →
-- "Rest Room"); names that already omit duration (e.g. "Thai Massage") are
-- unchanged and naturally group together.
-- ===========================================================================
ALTER TABLE public.service_items ADD COLUMN service_group TEXT;

UPDATE public.service_items
   SET service_group = trim(regexp_replace(name, '\s*[0-9]+\s*min$', '', 'i'))
 WHERE service_group IS NULL;
