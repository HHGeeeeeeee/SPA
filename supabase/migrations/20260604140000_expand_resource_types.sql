-- Expand the station-type taxonomy with three real HSPA station types that the
-- floor plan needs but the original five-type CHECK (20260530120000) rejected:
--   hairwash_bed        — hair-wash beds (HSPA1 1F)
--   facial_bed          — facial treatment beds (HSPA1 3F)
--   nail_massage_chair  — chairs usable for both nail work and massage (HSPA2 1F)
--
-- Kept in sync with src/lib/resource-types.ts (same eight values, same order).
-- Drop + re-add each CHECK with the widened value list.

ALTER TABLE resources DROP CONSTRAINT resources_resource_type_check;
ALTER TABLE resources
  ADD CONSTRAINT resources_resource_type_check
  CHECK (resource_type IN (
    'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
    'hairwash_bed', 'facial_bed', 'nail_massage_chair'));

ALTER TABLE service_items DROP CONSTRAINT service_items_required_resource_type_check;
ALTER TABLE service_items
  ADD CONSTRAINT service_items_required_resource_type_check
  CHECK (required_resource_type IS NULL
         OR required_resource_type IN (
           'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
           'hairwash_bed', 'facial_bed', 'nail_massage_chair'));

ALTER TABLE service_categories DROP CONSTRAINT service_categories_required_resource_type_check;
ALTER TABLE service_categories
  ADD CONSTRAINT service_categories_required_resource_type_check
  CHECK (required_resource_type IS NULL
         OR required_resource_type IN (
           'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
           'hairwash_bed', 'facial_bed', 'nail_massage_chair'));