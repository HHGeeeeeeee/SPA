-- A service item can be performed at ANY of several station types, not just one.
-- e.g. nail work runs at a Nail Station OR a Chair; a combination massage at a
-- Massage Bed only. Replace the single `required_resource_type` with an
-- allowed-set array `allowed_resource_types`.
--
-- Semantics (mirrors the old NULL / single-value behaviour):
--   {}                -> no station required (was NULL / "— None —")
--   {massage_bed}     -> must use a Massage Bed (was a single value)
--   {nail_station,chair} -> may use either a Nail Station or a Chair (new)
--
-- The item-level set is the authoritative station constraint for an order line;
-- service_categories.required_resource_type stays a single value (it's a coarse
-- reservation/category-capacity hint, not the per-line rule).

ALTER TABLE service_items
  ADD COLUMN allowed_resource_types TEXT[] NOT NULL DEFAULT '{}';

-- Backfill the array from the existing single value (NULL -> empty array).
UPDATE service_items
  SET allowed_resource_types = ARRAY[required_resource_type]
  WHERE required_resource_type IS NOT NULL;

-- Every element must be a known station type. `<@` = "is contained by".
-- Kept in sync with src/lib/resource-types.ts (same eight values).
ALTER TABLE service_items
  ADD CONSTRAINT service_items_allowed_resource_types_check
  CHECK (allowed_resource_types <@ ARRAY[
    'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
    'hairwash_bed', 'facial_bed', 'chair']::text[]);

-- Drop the old single-value column (its CHECK is dropped automatically with it).
ALTER TABLE service_items DROP COLUMN required_resource_type;
