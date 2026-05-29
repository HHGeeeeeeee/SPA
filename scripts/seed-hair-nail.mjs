// Phase 3 seed: round out Hair / Nail business unit so it's demoable end-to-end.
// Idempotent — upserts on natural keys, safe to re-run.
//
// Adds:
//   1. Stations  — 1 hair_chair + 1 nail_station per branch (OSP1 / OSP2)
//   2. Employees — 2 hair stylists + 2 nail technicians, mixed across branches
//   3. Services  — 3 nail service items (Manicure, Pedicure, Gel Polish)
//   4. Prices    — global "Normal" price for each new nail service, effective
//                  2026-05-01 (matches the existing hair-cut baseline)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// ── Lookups
console.log('Looking up FKs…');
const [{ data: branches }, { data: categories }, { data: classes }, { data: positions }, { data: bUnits }] = await Promise.all([
  sb.from('branches').select('id, code'),
  sb.from('service_categories').select('id, code'),
  sb.from('commission_classes').select('id, class_code'),
  sb.from('positions').select('id, code'),
  sb.from('business_units').select('id, code'),
]);
const byCode = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.id]));
const branchId = byCode(branches ?? [], 'code');
const categoryId = byCode(categories ?? [], 'code');
const classId = byCode(classes ?? [], 'class_code');
const positionId = byCode(positions ?? [], 'code');
const bUnitId = byCode(bUnits ?? [], 'code');
// business_unit text column has been migrated to a business_unit_id FK (see
// 20260519164258_business_units_master.sql). All new rows write the UUID.
const SPA_UNIT = bUnitId.spa;

for (const [need, val] of Object.entries({
  'branch OSP1': branchId.OSP1, 'branch OSP2': branchId.OSP2,
  'category HAIR': categoryId.HAIR, 'category NAIL': categoryId.NAIL,
  'class J': classId.J,
  'position HAIR_STYLIST': positionId.HAIR_STYLIST,
  'position NAIL_TECHNICIAN': positionId.NAIL_TECHNICIAN,
  'business_unit spa': SPA_UNIT,
})) {
  if (!val) { console.error(`✗ missing: ${need}`); process.exit(1); }
}

// ── 1. Stations
console.log('\n=== Stations ===');
const stations = [
  { branch: 'OSP1', type: 'hair_chair',   name: 'Hair Chair A',   zone: 'OSP1-1F' },
  { branch: 'OSP2', type: 'hair_chair',   name: 'Hair Chair A',   zone: 'OSP2-1F' },
  { branch: 'OSP1', type: 'nail_station', name: 'Nail Station A', zone: 'OSP1-1F' },
  { branch: 'OSP2', type: 'nail_station', name: 'Nail Station A', zone: 'OSP2-1F' },
];
for (const s of stations) {
  // No unique constraint on (branch_id, resource_name) — do a check-then-insert
  // so re-runs don't pile up duplicates.
  const { data: existing } = await sb.from('resources')
    .select('id, status')
    .eq('branch_id', branchId[s.branch])
    .eq('resource_name', s.name)
    .eq('resource_type', s.type)
    .maybeSingle();
  if (existing) {
    console.log(`  · ${s.branch}  ${s.type.padEnd(13)} ${s.name}  already exists (${existing.status})`);
    continue;
  }
  const { error } = await sb.from('resources').insert({
    branch_id: branchId[s.branch],
    resource_type: s.type,
    resource_name: s.name,
    location_zone: s.zone,
    capacity: 1,
    business_unit_id: SPA_UNIT,
    status: 'active',
  });
  if (error) { console.error(`✗ ${s.branch} ${s.name}: ${error.message}`); continue; }
  console.log(`  ✓ ${s.branch}  ${s.type.padEnd(13)} ${s.name}`);
}

// ── 2. Employees — next available codes per branch (after OSP1-007, OSP2-009)
console.log('\n=== Employees ===');
const employees = [
  { code: 'OSP1-008', name: 'Rosa Mendoza',  branch: 'OSP1', gender: 'F', position: 'HAIR_STYLIST',    class: 'J' },
  { code: 'OSP2-010', name: 'Marco Aquino',  branch: 'OSP2', gender: 'M', position: 'HAIR_STYLIST',    class: 'J' },
  { code: 'OSP1-009', name: 'Bea Castro',    branch: 'OSP1', gender: 'F', position: 'NAIL_TECHNICIAN', class: 'J' },
  { code: 'OSP2-011', name: 'Patricia Lim',  branch: 'OSP2', gender: 'F', position: 'NAIL_TECHNICIAN', class: 'J' },
];
for (const e of employees) {
  const { error } = await sb.from('employees').upsert(
    {
      employee_code: e.code,
      name: e.name,
      gender: e.gender,
      home_branch_id: branchId[e.branch],
      commission_class_id: classId[e.class],
      position_id: positionId[e.position],
      business_unit_id: SPA_UNIT,
      status: 'active',
    },
    { onConflict: 'employee_code' },
  );
  if (error) { console.error(`✗ ${e.code}: ${error.message}`); continue; }
  console.log(`  ✓ ${e.code}  ${e.name.padEnd(16)} ${e.position.padEnd(16)} @${e.branch}`);
}

// ── 3. Nail service items
console.log('\n=== Nail service items ===');
const nailServices = [
  { code: 'N_MANI', name: 'Manicure',    duration: 45, prep: 5, cleanup: 5 },
  { code: 'N_PEDI', name: 'Pedicure',    duration: 60, prep: 5, cleanup: 5 },
  { code: 'N_GEL',  name: 'Gel Polish',  duration: 60, prep: 5, cleanup: 10 },
];
for (const it of nailServices) {
  const { error } = await sb.from('service_items').upsert(
    {
      code: it.code,
      name: it.name,
      // service_group drives the "Skills this therapist can perform" picker on
      // the Employees page (distinct-on service_group). Items with NULL group
      // are silently dropped from that picker, so always set it explicitly —
      // for nail services there's no duration suffix to strip, so group=name.
      service_group: it.name,
      service_category_id: categoryId.NAIL,
      duration_minutes: it.duration,
      prep_before_minutes: it.prep,
      cleanup_after_minutes: it.cleanup,
      required_resource_type: 'nail_station',
      pricing_model: 'per_session',
      commission_applicable: true,
      tip_applicable: true,
      business_unit_id: SPA_UNIT,
      active: true,
    },
    { onConflict: 'code' },
  );
  if (error) { console.error(`✗ ${it.code}: ${error.message}`); continue; }
  console.log(`  ✓ ${it.code.padEnd(8)} ${it.name.padEnd(14)} ${it.duration}min  → nail_station`);
}

// ── 4. Prices (global "Normal" class, effective 2026-05-01)
console.log('\n=== Nail service prices (global, effective 2026-05-01) ===');
const prices = [
  { code: 'N_MANI', cents: 35000 },  // ₱350
  { code: 'N_PEDI', cents: 50000 },  // ₱500
  { code: 'N_GEL',  cents: 80000 },  // ₱800
];
const { data: nailItems } = await sb.from('service_items')
  .select('id, code').in('code', prices.map((p) => p.code));
const itemIdByCode = Object.fromEntries((nailItems ?? []).map((r) => [r.code, r.id]));

for (const p of prices) {
  const item_id = itemIdByCode[p.code];
  if (!item_id) { console.error(`✗ ${p.code}: service item lookup failed`); continue; }
  // Check if a global Normal price already exists for this item; if so skip
  // (avoids the no-overlap btree_gist exclusion fighting us on re-run).
  const { data: existing } = await sb.from('service_item_prices')
    .select('id, price_cents')
    .eq('service_item_id', item_id)
    .eq('price_class', 'Normal')
    .is('branch_id', null);
  if (existing && existing.length > 0) {
    console.log(`  · ${p.code.padEnd(8)} already priced — skip (existing ₱${existing[0].price_cents / 100})`);
    continue;
  }
  const { error } = await sb.from('service_item_prices').insert({
    service_item_id: item_id,
    price_class: 'Normal',
    branch_id: null,
    effective_from: '2026-05-01',
    effective_to: '2999-12-31',
    price_cents: p.cents,
    currency: 'PHP',
  });
  if (error) { console.error(`✗ ${p.code}: ${error.message}`); continue; }
  console.log(`  ✓ ${p.code.padEnd(8)} ₱${p.cents / 100}  2026-05-01 → ∞`);
}

console.log('\nDone.');
process.exit(0);
