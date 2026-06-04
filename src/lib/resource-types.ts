// Single source of truth for the station / resource-type vocabulary. Used by:
//  - Service Stations (resource) — what a physical station IS
//  - Service Items — which station a service needs
//  - Service Categories — which station a category needs (reservation capacity)
//  - the reservation capacity panel
// Keep these values in sync with resources.resource_type so capacity matching works.
export type ResourceType =
  | 'massage_bed'
  | 'rest_room'
  | 'hair_chair'
  | 'nail_station'
  | 'steam_room'
  | 'hairwash_bed'
  | 'facial_bed'
  | 'chair';

export const RESOURCE_TYPES: { value: ResourceType; label: string }[] = [
  { value: 'massage_bed', label: 'Massage Bed' },
  { value: 'rest_room', label: 'Rest Room' },
  { value: 'hair_chair', label: 'Hair Chair' },
  { value: 'nail_station', label: 'Nail Station' },
  { value: 'steam_room', label: 'Steam Room' },
  { value: 'hairwash_bed', label: 'Hairwash Bed' },
  { value: 'facial_bed', label: 'Facial Bed' },
  { value: 'chair', label: 'Chair' },
];

export const RESOURCE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  RESOURCE_TYPES.map((r) => [r.value, r.label]),
);
