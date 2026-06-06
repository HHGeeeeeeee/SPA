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
 * its child tables (order_items, order_customers, payments, tips, feedback)
 * with before/after JSONB so the UI can render field-level diffs.
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
  addBucket('payments', paymentIds);
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
 *  field name to (table, column) so we can batch-query each lookup table. */
const FK_FIELDS: Record<string, { table: string; col: string }> = {
  therapist_id:       { table: 'employees',          col: 'display_name' },
  resource_id:        { table: 'resources',           col: 'resource_name' },
  service_item_id:    { table: 'service_items',       col: 'name' },
  service_category_id:{ table: 'service_categories',  col: 'name' },
  discount_class_id:  { table: 'discount_classes',    col: 'code' },
  source_id:          { table: 'customer_sources',    col: 'source_name' },
  billing_to_id:      { table: 'billing_entities',    col: 'name' },
  payment_method_id:  { table: 'payment_methods',     col: 'name' },
};

/** Collect all UUIDs referenced in before/after for FK fields, batch-query each
 *  lookup table, and return a flat id→name map the UI can use. */
async function resolveAuditNames(
  sb: ReturnType<typeof createServiceClient>,
  rows: AuditRowDb[],
): Promise<AuditNameMap> {
  // Collect UUIDs per FK field.
  const idsByField = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const rec of [r.before, r.after]) {
      if (!rec) continue;
      for (const [k, v] of Object.entries(rec)) {
        if (FK_FIELDS[k] && typeof v === 'string' && UUID_RE.test(v)) {
          const s = idsByField.get(k) ?? new Set();
          s.add(v);
          idsByField.set(k, s);
        }
      }
    }
  }

  const names: AuditNameMap = {};
  const q = async (ids: Set<string> | undefined, query: Promise<{ data: { id: string; _name: string }[] | null }>) => {
    if (!ids || ids.size === 0) return;
    const { data } = await query;
    for (const r of data ?? []) if (r._name) names[r.id] = r._name;
  };
  await Promise.all([
    q(idsByField.get('therapist_id'),
      sb.from('employees').select('id, _name:display_name').in('id', [...(idsByField.get('therapist_id') ?? [])]) as never),
    q(idsByField.get('resource_id'),
      sb.from('resources').select('id, _name:resource_name').in('id', [...(idsByField.get('resource_id') ?? [])]) as never),
    q(idsByField.get('service_item_id'),
      sb.from('service_items').select('id, _name:name').in('id', [...(idsByField.get('service_item_id') ?? [])]) as never),
    q(idsByField.get('service_category_id'),
      sb.from('service_categories').select('id, _name:name').in('id', [...(idsByField.get('service_category_id') ?? [])]) as never),
    q(idsByField.get('discount_class_id'),
      sb.from('discount_classes').select('id, _name:code').in('id', [...(idsByField.get('discount_class_id') ?? [])]) as never),
    q(idsByField.get('source_id'),
      sb.from('customer_sources').select('id, _name:name').in('id', [...(idsByField.get('source_id') ?? [])]) as never),
    q(idsByField.get('billing_to_id'),
      sb.from('billing_destinations').select('id, _name:name').in('id', [...(idsByField.get('billing_to_id') ?? [])]) as never),
    q(idsByField.get('payment_method_id'),
      sb.from('payment_methods').select('id, _name:name').in('id', [...(idsByField.get('payment_method_id') ?? [])]) as never),
  ]);
  return names;
}
