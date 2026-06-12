import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';

export interface AuditEntry {
  id: number;
  tableName: string;
  rowId: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changedAt: string;
  actor: { name: string | null; email: string | null } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** UUID → human name for FK fields shown in the audit diff. */
export type AuditNameMap = Record<string, string>;

/**
 * Full audit trail for one order — every row change on the order itself plus
 * its child tables (order_items, order_customers, folio_lines payments/refunds,
 * tips, feedback) with before/after JSONB so the UI can render field-level diffs.
 *
 * Sorted newest-first. Actor resolved to display_name + email so the timeline
 * shows the human who made the change. Returns [] when audit_log has nothing
 * for this order yet — UI renders an empty state.
 */
export async function loadOrderAuditTrail(orderId: string): Promise<{ entries: AuditEntry[]; names: AuditNameMap }> {
  const sb = createServiceClient();

  // Resolve all child entity ids first — audit_log keys by table_name + row_id
  // so we need to know which ids belong to this order. Items first because
  // feedback hangs off order_item_id.
  const [items, customers, payments, tips] = await Promise.all([
    sb.from('order_items').select('id').eq('order_id', orderId),
    sb.from('order_customers').select('id').eq('order_id', orderId),
    sb.from('folio_lines').select('id').eq('order_id', orderId).in('kind', ['payment', 'refund']),
    sb.from('tips').select('id').eq('order_id', orderId),
  ]);
  const itemIds = (items.data ?? []).map((r) => r.id as string);
  const customerIds = (customers.data ?? []).map((r) => r.id as string);
  const paymentIds = (payments.data ?? []).map((r) => r.id as string);
  const tipIds = (tips.data ?? []).map((r) => r.id as string);
  const feedbackIds: string[] = [];
  if (itemIds.length) {
    const { data: fb } = await sb.from('feedback').select('id').in('order_item_id', itemIds);
    for (const f of fb ?? []) feedbackIds.push(f.id as string);
  }

  // Parallel-fetch audit_log buckets per table. Empty buckets short-circuit
  // so we don't fire a no-op `IN ()` query (Supabase would reject). Query
  // builders are thenable — Promise.all awaits them all.
  const buckets = [
    sb.from('audit_log').select(SELECT_COLS).eq('table_name', 'orders').eq('row_id', orderId),
  ];
  const addBucket = (table: string, ids: string[]) => {
    if (ids.length === 0) return;
    buckets.push(sb.from('audit_log').select(SELECT_COLS).eq('table_name', table).in('row_id', ids));
  };
  addBucket('order_items', itemIds);
  addBucket('order_customers', customerIds);
  // Payments live on folio_lines now (the payments table is retired); the ids
  // above are folio_lines ids, so that's the table_name they're logged under.
  addBucket('folio_lines', paymentIds);
  addBucket('tips', tipIds);
  addBucket('feedback', feedbackIds);

  const results = await Promise.all(buckets);
  const rows: AuditRowDb[] = results.flatMap((r) => (r.data ?? []) as unknown as AuditRowDb[]);

  // Actor lookup — changed_by has no FK (audit must survive user deletion),
  // so resolve names from staff_users separately.
  const actorIds = [...new Set(rows.map((r) => r.changed_by).filter(Boolean) as string[])];
  const actorMap = new Map<string, { name: string | null; email: string | null }>();
  if (actorIds.length) {
    const { data: users } = await sb.from('staff_users').select('id, display_name, email').in('id', actorIds);
    for (const u of users ?? []) actorMap.set(u.id, { name: u.display_name, email: u.email });
  }

  // Newest first — matches the timeline reading direction (most recent at top).
  rows.sort((a, b) => b.changed_at.localeCompare(a.changed_at));

  // Resolve FK UUIDs (therapist, station, service, etc.) to human names so
  // the audit diff shows "Maria" instead of "a1b2c3d4…".
  const names = await resolveAuditNames(sb, rows);

  const entries = rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    rowId: r.row_id,
    action: r.action,
    changedAt: r.changed_at,
    actor: r.changed_by ? actorMap.get(r.changed_by) ?? null : null,
    before: r.before,
    after: r.after,
  }));
  return { entries, names };
}

const SELECT_COLS = 'id, table_name, row_id, action, changed_at, changed_by, before, after';

interface AuditRowDb {
  id: number;
  table_name: string;
  row_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
  changed_by: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** FK fields whose UUIDs should be resolved to human-readable names. Maps the
 *  field name to (table, column); resolveAuditNames batch-queries from this map
 *  directly, so it is the single source of truth — a wrong column here fails
 *  visibly for that field instead of silently drifting from a second list. */
const FK_FIELDS: Record<string, { table: string; col: string }> = {
  therapist_id:             { table: 'employees',            col: 'name' },
  resource_id:              { table: 'resources',            col: 'resource_name' },
  service_item_id:          { table: 'service_items',        col: 'name' },
  service_category_id:      { table: 'service_categories',   col: 'name' },
  discount_class_id:        { table: 'discount_classes',     col: 'code' },
  source_id:                { table: 'customer_sources',     col: 'name' },
  billing_to_id:            { table: 'billing_destinations', col: 'name' },
  billing_destination_id:   { table: 'billing_destinations', col: 'name' },
  external_hotel_id:        { table: 'billing_destinations', col: 'name' },
  payment_method_id:        { table: 'payment_methods',      col: 'name' },
  branch_id:                { table: 'branches',             col: 'name' },
  therapist_home_branch_id: { table: 'branches',             col: 'name' },
  commission_branch_id:     { table: 'branches',             col: 'name' },
  business_unit_id:         { table: 'business_units',       col: 'name' },
  order_customer_id:        { table: 'order_customers',      col: 'customer_name' },
  created_by_staff_user_id: { table: 'staff_users',          col: 'display_name' },
};

/** Collect all UUIDs referenced in before/after for FK fields, batch-query each
 *  lookup table, and return a flat id→name map the UI can use. */
async function resolveAuditNames(
  sb: ReturnType<typeof createServiceClient>,
  rows: AuditRowDb[],
): Promise<AuditNameMap> {
  // Collect UUIDs per lookup target (table+col) — several fields can share one
  // lookup (branch_id / therapist_home_branch_id / commission_branch_id).
  const idsByLookup = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const rec of [r.before, r.after]) {
      if (!rec) continue;
      for (const [k, v] of Object.entries(rec)) {
        const fk = FK_FIELDS[k];
        if (fk && typeof v === 'string' && UUID_RE.test(v)) {
          const key = `${fk.table}:${fk.col}`;
          const s = idsByLookup.get(key) ?? new Set();
          s.add(v);
          idsByLookup.set(key, s);
        }
      }
    }
  }

  const names: AuditNameMap = {};
  await Promise.all(
    [...idsByLookup].map(async ([key, ids]) => {
      const [table, col] = key.split(':');
      const { data } = await (sb.from as (t: string) => ReturnType<typeof sb.from>)(table)
        .select(`id, _name:${col}`)
        .in('id', [...ids]) as unknown as { data: { id: string; _name: string }[] | null };
      for (const r of data ?? []) if (r._name) names[r.id] = r._name;
    }),
  );
  return names;
}
