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

/**
 * Full audit trail for one order — every row change on the order itself plus
 * its child tables (order_items, order_customers, payments, tips, feedback)
 * with before/after JSONB so the UI can render field-level diffs.
 *
 * Sorted newest-first. Actor resolved to display_name + email so the timeline
 * shows the human who made the change. Returns [] when audit_log has nothing
 * for this order yet — UI renders an empty state.
 */
export async function loadOrderAuditTrail(orderId: string): Promise<AuditEntry[]> {
  const sb = createServiceClient();

  // Resolve all child entity ids first — audit_log keys by table_name + row_id
  // so we need to know which ids belong to this order. Items first because
  // feedback hangs off order_item_id.
  const [items, customers, payments, tips] = await Promise.all([
    sb.from('order_items').select('id').eq('order_id', orderId),
    sb.from('order_customers').select('id').eq('order_id', orderId),
    sb.from('payments').select('id').eq('order_id', orderId),
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

  return rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    rowId: r.row_id,
    action: r.action,
    changedAt: r.changed_at,
    actor: r.changed_by ? actorMap.get(r.changed_by) ?? null : null,
    before: r.before,
    after: r.after,
  }));
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
