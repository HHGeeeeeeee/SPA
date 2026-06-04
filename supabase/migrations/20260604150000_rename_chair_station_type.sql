-- Rename the station type added in 20260604140000 from 'nail_massage_chair'
-- to the simpler 'chair'. Still introduced one migration ago, only a handful of
-- HSPA2 1F rows use it and no service_items/service_categories reference it yet,
-- so this is a clean value rename. Kept in sync with src/lib/resource-types.ts.

-- Drop the CHECKs first so the data update is unconstrained.
ALTER TABLE resources DROP CONSTRAINT resources_resource_type_check;
ALTER TABLE service_items DROP CONSTRAINT service_items_required_resource_type_check;
ALTER TABLE service_categories DROP CONSTRAINT service_categories_required_resource_type_check;

UPDATE resources           SET resource_type          = 'chair' WHERE resource_type          = 'nail_massage_chair';
UPDATE service_items       SET required_resource_type = 'chair' WHERE required_resource_type = 'nail_massage_chair';
UPDATE service_categories  SET required_resource_type = 'chair' WHERE required_resource_type = 'nail_massage_chair';

-- Re-add the CHECKs with 'chair' replacing 'nail_massage_chair'.
ALTER TABLE resources
  ADD CONSTRAINT resources_resource_type_check
  CHECK (resource_type IN (
    'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
    'hairwash_bed', 'facial_bed', 'chair'));

ALTER TABLE service_items
  ADD CONSTRAINT service_items_required_resource_type_check
  CHECK (required_resource_type IS NULL
         OR required_resource_type IN (
           'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
           'hairwash_bed', 'facial_bed', 'chair'));

ALTER TABLE service_categories
  ADD CONSTRAINT service_categories_required_resource_type_check
  CHECK (required_resource_type IS NULL
         OR required_resource_type IN (
           'massage_bed', 'rest_room', 'hair_chair', 'nail_station', 'steam_room',
           'hairwash_bed', 'facial_bed', 'chair'));
