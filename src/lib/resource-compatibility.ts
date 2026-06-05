import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';

/**
 * Bed × service-category compatibility check.
 *
 * Each service_category declares an optional `required_resource_type` (e.g.
 * MASSAGE → `massage_bed`, HAIR → `hair_chair`, NAIL → `nail_station`). The
 * Schedule board, reservations, and order-item moves all let an operator
 * point a booking at a specific bed; without this guard a Hair Salon walk-in
 * happily lands on Bed #1 because the existence + busy checks pass.
 *
 * Policy: if any of the booking's categories names a required type, EVERY
 * pinned bed must match one of those types. Categories with NULL
 * `required_resource_type` are wildcards (no rule contributed). When all
 * categories are wildcards the function is a no-op — that matches how
 * `pickGroupBeds` was already behaving when the type set was empty.
 */
export async function assertBedsMatchCategories(
  bedIds: string[],
  categoryIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bedIds.length === 0 || categoryIds.length === 0) return { ok: true };
  const supabase = createServiceClient();
  const [{ data: beds }, { data: cats }] = await Promise.all([
    supabase.from('resources').select('id, resource_name, resource_type').in('id', bedIds),
    supabase.from('service_categories').select('required_resource_type').in('id', categoryIds),
  ]);
  const requiredTypes = new Set(
    (cats ?? [])
      .map((c) => c.required_resource_type)
      .filter((t): t is string => !!t),
  );
  if (requiredTypes.size === 0) return { ok: true };
  const mismatches = (beds ?? []).filter((b) => !requiredTypes.has(b.resource_type));
  if (mismatches.length === 0) return { ok: true };
  const names = mismatches.map((b) => b.resource_name).join(', ');
  const required = [...requiredTypes].join(' or ');
  return {
    ok: false,
    error: `${names} can't be used for this service (requires ${required})`,
  };
}

/**
 * Same compatibility check, expressed per service item — the order_item flow
 * has a single service rather than a list of categories.
 *
 * The service item's own `allowed_resource_types` is the authoritative rule: a
 * service may name several acceptable station types (e.g. nail work at a Nail
 * Station OR a Chair), and the pinned bed must match one of them. When the item
 * pins no types it falls back to the coarser category-level rule, so older items
 * that only carry a category constraint keep working unchanged.
 */
export async function assertBedMatchesServiceItem(
  bedId: string,
  serviceItemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceClient();
  const { data: svc } = await supabase
    .from('service_items')
    .select('allowed_resource_types, service_category_id')
    .eq('id', serviceItemId)
    .maybeSingle();

  const allowed = svc?.allowed_resource_types ?? [];
  if (allowed.length > 0) {
    const { data: bed } = await supabase
      .from('resources')
      .select('resource_name, resource_type')
      .eq('id', bedId)
      .maybeSingle();
    if (!bed) return { ok: true };
    if (bed.resource_type && allowed.includes(bed.resource_type)) return { ok: true };
    return {
      ok: false,
      error: `${bed.resource_name} can't be used for this service (requires ${allowed.join(' or ')})`,
    };
  }

  // No item-level types pinned — fall back to the service category's rule.
  if (!svc?.service_category_id) return { ok: true };
  return assertBedsMatchCategories([bedId], [svc.service_category_id]);
}
