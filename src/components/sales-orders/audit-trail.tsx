'use client';

import { History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { AuditEntry, AuditNameMap } from '@/lib/order-audit-trail';

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Action-badge label per (table, action). Mirrors the operator's mental
 *  model: it's not "UPDATE orders" — it's "Update Order". */
function actionLabel(table: string, action: AuditEntry['action']): string {
  const verb = action === 'INSERT' ? 'Create' : action === 'DELETE' ? 'Remove' : 'Update';
  const noun: Record<string, string> = {
    orders: 'Order',
    order_items: 'Service',
    order_customers: 'Guest',
    payments: 'Payment',
    folio_lines: 'Payment',
    tips: 'Tip',
    feedback: 'Feedback',
  };
  return `${verb} ${noun[table] ?? table}`;
}

/** Coloured chip variant per action — gives the timeline a visual rhythm so
 *  the eye can pick out destructive events (red) vs additions (green) vs
 *  edits (default). */
function actionVariant(action: AuditEntry['action']): 'default' | 'secondary' | 'destructive' {
  if (action === 'INSERT') return 'default';
  if (action === 'DELETE') return 'destructive';
  return 'secondary';
}

/** A few cosmetic field renamings — everything else is auto-titlecased from
 *  snake_case at render time. Kept short on purpose: the goal is to fix
 *  legitimately confusing names, not to maintain a full translation table. */
const FIELD_LABEL: Record<string, string> = {
  paid_cents: 'Paid',
  total_cents: 'Total',
  subtotal_cents: 'Subtotal',
  discount_cents: 'Discount',
  list_price_cents: 'List Price',
  final_amount_cents: 'Final Amount',
  discount_amount_cents: 'Discount Amount',
  amount_cents: 'Amount',
  commission_amount_cents: 'Commission',
  customer_name: 'Guest Name',
  customer_phone: 'Guest Phone',
  service_item_id: 'Service',
  service_category_id: 'Service Category',
  therapist_id: 'Therapist',
  therapist_home_branch_id: 'Therapist Home Branch',
  resource_id: 'Station',
  branch_id: 'Branch',
  commission_branch_id: 'Commission Branch',
  business_unit_id: 'Business Unit',
  order_customer_id: 'Guest',
  created_by_staff_user_id: 'Created By',
  external_hotel_id: 'Hotel',
  discount_class_id: 'Discount Class',
  billing_to_id: 'Billing To',
  source_id: 'Customer Source',
  payment_method_id: 'Payment Method',
  interruption_reason: 'Interrupt Reason',
  interruption_handling: 'Interrupt Handling',
  reschedule_fulfilled_at: 'Reschedule Fulfilled',
  posting_status: 'ERP Posting',
  gl_batch_nbr: 'GL Batch #',
};

function titleCaseKey(key: string): string {
  return FIELD_LABEL[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Skip noisy plumbing fields — audit_log itself records who/when, so re-
 *  rendering created_at/updated_at as part of every UPDATE diff is just
 *  visual noise. ids are likewise infrastructure, not user-meaningful. */
const SKIP_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
]);

/** Best-effort value formatter — keeps the rendering pure so the diff is
 *  side-effect free and consistent across before/after. `names` resolves FK
 *  UUIDs to human labels (e.g. therapist_id → "Maria"). */
function formatValue(key: string, v: unknown, names: AuditNameMap): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    // Money-ish fields stored as cents.
    if (key.endsWith('_cents')) return `₱${(v / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
    return String(v);
  }
  if (typeof v === 'string') {
    // ISO timestamp → locale date+time
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      return new Date(v).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'short', timeStyle: 'short' });
    }
    // Bare date
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    // UUID — resolve via name map first, else show truncated id
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) {
      return names[v] ?? v.slice(0, 8) + '…';
    }
    return v;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
  display: 'changed' | 'added' | 'removed';
}

/** Produce a list of field-level diffs for one audit row. Handles INSERT
 *  (added), UPDATE (changed), DELETE (removed). Skips identity / timestamp
 *  plumbing fields. Stable order via Object.keys on after ∪ before. */
function diffFields(action: AuditEntry['action'], before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldDiff[] {
  const out: FieldDiff[] = [];
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (SKIP_FIELDS.has(k)) continue;
    const b = before?.[k];
    const a = after?.[k];
    if (action === 'INSERT') {
      if (a === null || a === undefined || a === '' || a === 0 || a === false) continue; // skip empty defaults
      out.push({ field: k, before: undefined, after: a, display: 'added' });
    } else if (action === 'DELETE') {
      if (b === null || b === undefined || b === '') continue;
      out.push({ field: k, before: b, after: undefined, display: 'removed' });
    } else {
      // UPDATE — only emit when actually changed
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      out.push({ field: k, before: b, after: a, display: 'changed' });
    }
  }
  return out;
}

/** Context line shown above the diff card — for child entities, identifies
 *  WHICH row was changed. Pulls from after (or before for DELETE). */
function entityContext(table: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string | null {
  const src = after ?? before;
  if (!src) return null;
  if (table === 'order_customers') {
    const name = src.customer_name;
    if (typeof name === 'string' && name) return `Guest: ${name}`;
    return null;
  }
  if (table === 'order_items') {
    const seq = src.item_seq;
    return seq != null ? `Service line #${seq}` : 'Service line';
  }
  if (table === 'payments' || table === 'folio_lines') {
    const amount = src.amount_cents;
    const noun = src.kind === 'refund' ? 'Refund' : 'Payment';
    if (typeof amount === 'number') return `${noun} ₱${(amount / 100).toFixed(0)}`;
    return noun;
  }
  if (table === 'tips') {
    const amount = src.amount_cents;
    if (typeof amount === 'number') return `Tip ₱${(amount / 100).toFixed(0)}`;
    return 'Tip';
  }
  if (table === 'feedback') {
    const score = src.score;
    return score != null ? `Feedback (★${score})` : 'Feedback';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

function actorDisplay(actor: AuditEntry['actor']): string {
  if (!actor) return 'system';
  return actor.email ?? actor.name ?? 'unknown';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function AuditTrail({ entries, names = {} }: { entries: AuditEntry[]; names?: AuditNameMap }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm font-medium text-muted-foreground px-1 py-4">
        No audit entries logged yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-1 py-2">
      <h3 className="flex items-center gap-2 text-base font-bold mb-2">
        <History className="size-4 text-primary" />
        Audit Trail
      </h3>
      <ol className="relative flex flex-col gap-3 border-l border-border pl-6 ml-2">
        {entries.map((e) => {
          const diffs = diffFields(e.action, e.before, e.after);
          const context = entityContext(e.tableName, e.before, e.after);
          return (
            <li key={e.id} className="relative">
              {/* Timeline dot, sits on the parent's left border */}
              <span className="absolute -left-[1.85rem] top-1 size-3 rounded-full border-2 border-primary bg-background" />

              {/* Header line: actor on the LEFT (per user request), badge,
                  then timestamp on its own line below. */}
              <div className="flex items-baseline flex-wrap gap-2 text-sm">
                <span className="font-semibold">{actorDisplay(e.actor)}</span>
                <Badge variant={actionVariant(e.action)} className="font-bold uppercase tracking-wide text-[10px]">
                  {actionLabel(e.tableName, e.action)}
                </Badge>
              </div>
              <div className="text-xs font-medium text-muted-foreground tabular mt-0.5">
                {fmtTime(e.changedAt)}
              </div>

              {/* Diff card — only when there are actual field changes. INSERT
                  with everything-empty after / UPDATE with no observable
                  field change collapses to no card. */}
              {(diffs.length > 0 || context) && (
                <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  {context && (
                    <div className="mb-2 text-xs font-semibold text-muted-foreground border-b border-border pb-1.5">
                      {context}
                    </div>
                  )}
                  {diffs.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {diffs.map((d) => (
                        <li key={d.field} className="flex items-baseline flex-wrap gap-2 min-w-0">
                          <span className="font-semibold text-muted-foreground shrink-0">
                            {titleCaseKey(d.field)}:
                          </span>
                          {d.display === 'changed' && (
                            <>
                              <span className="rounded bg-destructive/10 text-destructive line-through px-1.5 py-0.5 text-xs font-bold tabular">
                                {formatValue(d.field, d.before, names)}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-bold tabular">
                                {formatValue(d.field, d.after, names)}
                              </span>
                            </>
                          )}
                          {d.display === 'added' && (
                            <>
                              <span className="text-muted-foreground text-xs">—</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-bold tabular">
                                {formatValue(d.field, d.after, names)}
                              </span>
                            </>
                          )}
                          {d.display === 'removed' && (
                            <>
                              <span className="rounded bg-destructive/10 text-destructive line-through px-1.5 py-0.5 text-xs font-bold tabular">
                                {formatValue(d.field, d.before, names)}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-muted-foreground text-xs">—</span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs font-medium text-muted-foreground italic">
                      (No field-level changes detected — e.g. a no-op save.)
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
