'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAuditedClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import { requireManager } from '@/lib/auth';

type ServiceItemUpdate = Database['public']['Tables']['service_items']['Update'];

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  service_group: z.string().max(80).optional().nullable(),
  service_category_id: z.string().uuid(),
  duration_minutes: z.coerce.number().int().min(1).max(600),
  prep_before_minutes: z.coerce.number().int().min(0).max(120).default(0),
  cleanup_after_minutes: z.coerce.number().int().min(0).max(120).default(0),
  required_resource_type: z.string().max(40).optional().nullable(),
  pricing_model: z.enum(['per_session', 'membership_unlimited', 'membership_quota', 'subscription']).default('per_session'),
  commission_applicable: z.boolean().default(true),
  tip_applicable: z.boolean().default(true),
  business_unit_id: z.string().uuid().optional().nullable(),
  price: z.coerce.number().min(0).optional(),
});

const updateSchema = schema.partial().extend({ id: z.string().uuid() });

export type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const PRICE_FROM = '2026-05-01'; // SPA go-live baseline for a new item's opening price
const PRICE_TO = '2999-12-31';

// Upsert the canonical "Normal" all-branch open-ended price row for an item.
async function syncNormalPrice(serviceItemId: string, pricePhp: number) {
  const supabase = await createAuditedClient();
  const priceCents = Math.round(pricePhp * 100);
  const { data: existing } = await supabase
    .from('service_item_prices')
    .select('id')
    .eq('service_item_id', serviceItemId)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .limit(1);
  if (existing && existing.length > 0) {
    return (await supabase.from('service_item_prices').update({ price_cents: priceCents }).eq('id', existing[0].id)).error;
  }
  return (await supabase.from('service_item_prices').insert({
    service_item_id: serviceItemId,
    price_class: 'Normal',
    branch_id: null,
    effective_from: PRICE_FROM,
    effective_to: PRICE_TO,
    price_cents: priceCents,
  })).error;
}

// Strip " NNmin" (case-insensitive) from the name to derive a default
// service_group. Matches the regex used by the original backfill migration
// (20260520125133_service_group). Items that don't carry a duration suffix
// just get group = full name.
function deriveServiceGroup(name: string): string {
  return name.replace(/\s*\d+\s*min$/i, '').trim() || name.trim();
}

export async function createServiceItem(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { price, ...fields } = parsed.data;
  const supabase = await createAuditedClient();
  const { data, error } = await supabase
    .from('service_items')
    .insert({
      ...fields,
      // Default service_group to the name-without-duration when the form
      // leaves it blank. NULL group makes the item invisible in the
      // Employees skill picker, which is a silent-failure trap; auto-deriving
      // matches what the backfill migration did for the seed rows.
      service_group: fields.service_group || deriveServiceGroup(fields.name),
      required_resource_type: fields.required_resource_type || null,
      active: true,
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: `Code "${parsed.data.code}" already exists` };
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }
  if (price !== undefined) {
    const pe = await syncNormalPrice(data.id, price);
    if (pe) return { ok: false, error: pe.message };
  }
  revalidatePath('/settings/service-items');
  return { ok: true };
}

export async function updateServiceItem(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: ServiceItemUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  // Same defensive default as createServiceItem: if the form clears
  // service_group, fall back to deriving it from the (new or existing) name so
  // the item stays visible in the Employees skill picker.
  if (d.service_group !== undefined) {
    if (d.service_group) {
      patch.service_group = d.service_group;
    } else {
      let baseName = d.name;
      if (!baseName) {
        const { data: cur } = await (await createAuditedClient())
          .from('service_items').select('name').eq('id', d.id).maybeSingle();
        baseName = cur?.name ?? '';
      }
      patch.service_group = baseName ? deriveServiceGroup(baseName) : null;
    }
  }
  if (d.service_category_id !== undefined) patch.service_category_id = d.service_category_id;
  if (d.duration_minutes !== undefined) patch.duration_minutes = d.duration_minutes;
  if (d.prep_before_minutes !== undefined) patch.prep_before_minutes = d.prep_before_minutes;
  if (d.cleanup_after_minutes !== undefined) patch.cleanup_after_minutes = d.cleanup_after_minutes;
  if (d.required_resource_type !== undefined) patch.required_resource_type = d.required_resource_type || null;
  if (d.pricing_model !== undefined) patch.pricing_model = d.pricing_model;
  if (d.commission_applicable !== undefined) patch.commission_applicable = d.commission_applicable;
  if (d.tip_applicable !== undefined) patch.tip_applicable = d.tip_applicable;
  if (d.business_unit_id !== undefined) patch.business_unit_id = d.business_unit_id ?? null;
  const supabase = await createAuditedClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('service_items').update(patch).eq('id', d.id);
    if (error) return { ok: false, error: error.message };
  }
  // NOTE: price is no longer changed here — it has an effective-dated timeline
  // managed via the price-schedule actions below, so editing service attributes
  // never silently rewrites price history.
  revalidatePath('/settings/service-items');
  return { ok: true };
}

const OPEN_TO = PRICE_TO; // '2999-12-31' sentinel = "current / until changed"

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface PriceSegment {
  id: string;
  price_cents: number;
  effective_from: string;
  effective_to: string;
  status: 'past' | 'current' | 'future';
  open_ended: boolean;
}

/** The Normal / all-branch price timeline for a service item, oldest first. */
export async function loadPriceSchedule(serviceItemId: string): Promise<PriceSegment[]> {
  // Read-only loader; return shape is the timeline array. The writes that
  // consume this (scheduleServicePriceChange / updateFuturePrice / etc.)
  // are admin-gated, so reading the price history isn't sensitive enough
  // to warrant gating here.
  const supabase = await createAuditedClient();
  const { data } = await supabase
    .from('service_item_prices')
    .select('id, price_cents, effective_from, effective_to')
    .eq('service_item_id', serviceItemId)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .order('effective_from', { ascending: true });
  const today = todayPHT();
  return (data ?? []).map((r) => ({
    id: r.id,
    price_cents: r.price_cents,
    effective_from: r.effective_from,
    effective_to: r.effective_to,
    open_ended: r.effective_to >= OPEN_TO,
    status: r.effective_to < today ? 'past' : r.effective_from > today ? 'future' : 'current',
  }));
}

const scheduleSchema = z.object({
  service_item_id: z.string().uuid(),
  price: z.coerce.number().positive(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
});

/** Schedule a price change: cap the open segment, then open a new one. */
export async function scheduleServicePriceChange(input: unknown): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { service_item_id, price, effective_from } = parsed.data;
  if (effective_from < todayPHT()) return { ok: false, error: 'Effective date cannot be in the past' };
  const supabase = await createAuditedClient();

  // The latest (open) segment is the one we split.
  const { data: open } = await supabase
    .from('service_item_prices')
    .select('id, effective_from, effective_to')
    .eq('service_item_id', service_item_id)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) {
    if (effective_from <= open.effective_from) {
      return { ok: false, error: 'New price must start after the current price’s start date' };
    }
    const cap = await supabase
      .from('service_item_prices')
      .update({ effective_to: addDays(effective_from, -1) })
      .eq('id', open.id);
    if (cap.error) return { ok: false, error: cap.error.message };
  }
  const { error } = await supabase.from('service_item_prices').insert({
    service_item_id, price_class: 'Normal', branch_id: null,
    effective_from, effective_to: OPEN_TO, price_cents: Math.round(price * 100),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-items');
  return { ok: true };
}

/** Edit the price of a not-yet-effective (future) segment. */
export async function updateFuturePrice(priceId: string, pricePhp: number): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  if (!(pricePhp > 0)) return { ok: false, error: 'Price must be greater than 0' };
  const supabase = await createAuditedClient();
  const { data: row } = await supabase.from('service_item_prices').select('effective_from').eq('id', priceId).maybeSingle();
  if (!row) return { ok: false, error: 'Price not found' };
  if (row.effective_from <= todayPHT()) return { ok: false, error: 'Only a future price change can be edited' };
  const { error } = await supabase.from('service_item_prices').update({ price_cents: Math.round(pricePhp * 100) }).eq('id', priceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-items');
  return { ok: true };
}

/** Cancel the latest future price change, re-opening the prior segment. */
export async function deleteFuturePrice(priceId: string): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { data: row } = await supabase
    .from('service_item_prices')
    .select('id, service_item_id, effective_from, effective_to')
    .eq('id', priceId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Price not found' };
  if (row.effective_from <= todayPHT()) return { ok: false, error: 'Only a future price change can be removed' };
  // Only the latest segment can be removed, so the timeline stays a clean chain.
  const { data: later } = await supabase
    .from('service_item_prices')
    .select('id')
    .eq('service_item_id', row.service_item_id)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .gt('effective_from', row.effective_from)
    .limit(1);
  if (later && later.length > 0) return { ok: false, error: 'Remove the latest scheduled change first' };

  const del = await supabase.from('service_item_prices').delete().eq('id', priceId);
  if (del.error) return { ok: false, error: del.error.message };
  // Re-open the segment that immediately preceded it.
  const { data: prev } = await supabase
    .from('service_item_prices')
    .select('id')
    .eq('service_item_id', row.service_item_id)
    .eq('price_class', 'Normal')
    .is('branch_id', null)
    .lt('effective_from', row.effective_from)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prev) {
    const reopen = await supabase.from('service_item_prices').update({ effective_to: row.effective_to }).eq('id', prev.id);
    if (reopen.error) return { ok: false, error: reopen.error.message };
  }
  revalidatePath('/settings/service-items');
  return { ok: true };
}

const batchSchema = z.object({
  service_item_ids: z.array(z.string().uuid()).min(1),
  // percent / amount: signed adjustment off the current price; set: absolute target price.
  mode: z.enum(['percent', 'amount', 'set']),
  value: z.coerce.number(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
});

// Round a cents amount to the nearest whole peso (₱1).
function roundPeso(cents: number): number {
  return Math.round(cents / 100) * 100;
}

/**
 * Batch-schedule a price change across many services: each item's open segment
 * is capped and a new segment opened with its price adjusted by a percentage or
 * a fixed amount (rounded to ₱1). Items that can't take the change are skipped
 * and reported rather than failing the whole batch.
 */
export async function batchScheduleServicePriceChange(
  input: unknown,
): Promise<ActionResult<{ applied: number; skipped: { label: string; reason: string }[] }>> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { service_item_ids, mode, value, effective_from } = parsed.data;
  if (effective_from < todayPHT()) return { ok: false, error: 'Effective date cannot be in the past' };
  const supabase = await createAuditedClient();

  const { data: metas } = await supabase.from('service_items').select('id, code, name').in('id', service_item_ids);
  const label = new Map((metas ?? []).map((m) => [m.id, `${m.code} — ${m.name}`]));

  let applied = 0;
  const skipped: { label: string; reason: string }[] = [];
  for (const id of service_item_ids) {
    const lbl = label.get(id) ?? id;
    const { data: open } = await supabase
      .from('service_item_prices')
      .select('id, price_cents, effective_from')
      .eq('service_item_id', id)
      .eq('price_class', 'Normal')
      .is('branch_id', null)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!open) { skipped.push({ label: lbl, reason: 'no price set' }); continue; }
    if (effective_from <= open.effective_from) { skipped.push({ label: lbl, reason: 'a later/equal price segment already exists' }); continue; }

    const base = open.price_cents;
    const raw = mode === 'percent' ? base * (1 + value / 100)
      : mode === 'amount' ? base + value * 100
      : value * 100; // set: absolute target
    const newCents = roundPeso(raw);
    if (newCents <= 0) { skipped.push({ label: lbl, reason: 'result would be ₱0 or less' }); continue; }
    if (newCents === base) { skipped.push({ label: lbl, reason: 'no change' }); continue; }

    const cap = await supabase.from('service_item_prices').update({ effective_to: addDays(effective_from, -1) }).eq('id', open.id);
    if (cap.error) { skipped.push({ label: lbl, reason: cap.error.message }); continue; }
    const ins = await supabase.from('service_item_prices').insert({
      service_item_id: id, price_class: 'Normal', branch_id: null,
      effective_from, effective_to: OPEN_TO, price_cents: newCents,
    });
    if (ins.error) {
      // Roll back the cap so the item keeps an open segment.
      await supabase.from('service_item_prices').update({ effective_to: OPEN_TO }).eq('id', open.id);
      skipped.push({ label: lbl, reason: ins.error.message });
      continue;
    }
    applied += 1;
  }
  if (applied === 0) return { ok: false, error: skipped[0]?.reason ? `Nothing applied — ${skipped[0].reason}` : 'Nothing applied' };
  revalidatePath('/settings/service-items');
  return { ok: true, data: { applied, skipped } };
}

export async function setServiceItemActive(id: string, active: boolean): Promise<ActionResult> {
  const denied = await requireManager();
  if (denied) return { ok: false, error: denied };
  const supabase = await createAuditedClient();
  const { error } = await supabase.from('service_items').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/service-items');
  return { ok: true };
}
