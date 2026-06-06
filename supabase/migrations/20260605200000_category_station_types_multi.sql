-- A service category can map to MULTIPLE station types (N:N), e.g. a Massage
-- category that can run on a Massage Bed OR a Chair. Mirrors what 20260605120000
-- did for service_items.allowed_resource_types.
--
-- Minimal-blast-radius rollout: we ADD an array column and KEEP the existing
-- single `required_resource_type`. The settings UI now writes the array; the
-- action keeps the single column in sync (= first element) so the current
-- reservation / calendar capacity readers keep working unchanged. A later phase
-- migrates those readers to the array and drops the single column.

ALTER TABLE service_categories
  ADD COLUMN required_resource_types TEXT[] NOT NULL DEFAULT '{}';

-- Backfill the array from the existing single value (NULL -> empty array).
UPDATE service_categories
  SET required_resource_types = ARRAY[required_resource_type]
  WHERE required_resource_type IS NOT NULL;

-- Every element must be a known station type. `<@` = "is contained by".
-- Kept in sync with src/lib/resource-types.ts (same eight values).
ALTER TABLE service_categories
  ADD CONSTRAINT service_categories_required_resource_types_check
  CHECK (required_resource_types <@ ARRAY[
    'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
    'hairwash_bed', 'facial_bed', 'chair']::text[]);