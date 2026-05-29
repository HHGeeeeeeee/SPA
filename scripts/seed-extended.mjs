#!/usr/bin/env node
// Phase 2 seed: resources, employees, service_items (depends on phase 1 seed).
// Usage: node scripts/seed-extended.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envText = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

async function main() {
  console.log('Phase 2 seed: looking up FKs…');

  // text-column FKs were migrated to UUID FKs:
  //   - business_unit → business_unit_id  (20260519164258_business_units_master)
  //   - employees.position → position_id  (20260519155607_add_positions_table)
  // Pull both new master tables so the inserts below can write the FKs.
  const { data: branches } = await supabase.from('branches').select('id, code');
  const { data: categories } = await supabase.from('service_categories').select('id, code');
  const { data: classes } = await supabase.from('commission_classes').select('id, class_code');
  const { data: bUnits } = await supabase.from('business_units').select('id, code');
  const { data: positions } = await supabase.from('positions').select('id, code');

  const byCode = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.id]));
  const branchId = byCode(branches ?? [], 'code');
  const categoryId = byCode(categories ?? [], 'code');
  const classId = byCode(classes ?? [], 'class_code');
  const bUnitId = byCode(bUnits ?? [], 'code');
  const positionId = byCode(positions ?? [], 'code');
  const SPA_UNIT = bUnitId.spa;
  const MASSAGE_THERAPIST = positionId.MASSAGE_THERAPIST;

  if (!branchId.OSP2 || !categoryId.MASSAGE || !classId.J) {
    throw new Error('Phase 1 seed missing required rows (OSP2 / MASSAGE / J)');
  }
  if (!SPA_UNIT) throw new Error('business_units.spa missing — run business_units_master migration first');
  if (!MASSAGE_THERAPIST) throw new Error('positions.MASSAGE_THERAPIST missing — run add_positions_table migration first');

  // ---- Resources (OSP1 + OSP2)
  console.log('  · resources');
  const resourceRows = [
    { branch: 'OSP1', type: 'massage_bed', name: 'Bed #1', zone: 'OSP1-2F', capacity: 1 },
    { branch: 'OSP1', type: 'massage_bed', name: 'Bed #2', zone: 'OSP1-2F', capacity: 1 },
    { branch: 'OSP1', type: 'hair_chair', name: 'Hair Chair A', zone: 'OSP1-1F', capacity: 1 },
    { branch: 'OSP2', type: 'massage_bed', name: 'Bed #1', zone: 'OSP2-2F', capacity: 1 },
    { branch: 'OSP2', type: 'massage_bed', name: 'Bed #2', zone: 'OSP2-2F', capacity: 1 },
    { branch: 'OSP2', type: 'massage_bed', name: 'Bed #3', zone: 'OSP2-2F', capacity: 1 },
    { branch: 'OSP2', type: 'massage_bed', name: 'Bed #4', zone: 'OSP2-3F', capacity: 1 },
    { branch: 'OSP2', type: 'massage_bed', name: 'VIP Suite', zone: 'OSP2-VIP', capacity: 2 },
    { branch: 'OSP2', type: 'hair_chair', name: 'Hair Chair A', zone: 'OSP2-1F', capacity: 1 },
    { branch: 'OSP2', type: 'rest_room', name: 'Rest Room A', zone: 'OSP2-3F', capacity: 2 },
  ];
  // resources has no UNIQUE constraint on (branch_id, resource_name), so the
  // old `upsert(..., { onConflict: ... })` would fail outright. Do a manual
  // check-then-insert keyed on (branch_id, resource_type, resource_name).
  for (const r of resourceRows) {
    const { data: existing } = await supabase
      .from('resources')
      .select('id')
      .eq('branch_id', branchId[r.branch])
      .eq('resource_type', r.type)
      .eq('resource_name', r.name)
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from('resources').insert({
      branch_id: branchId[r.branch],
      resource_type: r.type,
      resource_name: r.name,
      location_zone: r.zone,
      capacity: r.capacity,
      business_unit_id: SPA_UNIT,
      status: 'active',
    });
    if (error) throw error;
  }

  // ---- Employees
  console.log('  · employees');
  const employees = [
    { code: 'E001', name: 'Jack', phone: '63917000001', branch: 'OSP2', class: 'J', gender: 'M' },
    { code: 'E002', name: 'Yuna', phone: '63917000002', branch: 'OSP2', class: 'J', gender: 'F' },
    { code: 'E003', name: 'Maria', phone: '63917000003', branch: 'OSP2', class: 'J', gender: 'F' },
    { code: 'E004', name: 'Pedro', phone: '63917000004', branch: 'OSP2', class: 'J', gender: 'M' },
    { code: 'E005', name: 'Lily', phone: '63917000005', branch: 'OSP1', class: 'J', gender: 'F' },
  ];
  // employees has multiple unique keys (employee_code, phone). Supabase upsert
  // can only use one onConflict target, and after the initial bootstrap the
  // live DB may have re-coded these therapists (e.g. OSP{branch}-{seq}) while
  // keeping the original phone numbers — that would trip the phone constraint.
  // Skip if either key collides; the seed is fresh-DB-bootstrap data, not
  // something to replay over user edits.
  for (const e of employees) {
    const { data: existing } = await supabase
      .from('employees')
      .select('id, employee_code, name')
      .or(`employee_code.eq.${e.code},phone.eq.${e.phone}`)
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from('employees').insert({
      employee_code: e.code,
      name: e.name,
      phone: e.phone,
      gender: e.gender,
      home_branch_id: branchId[e.branch],
      commission_class_id: classId[e.class],
      position_id: MASSAGE_THERAPIST,
      business_unit_id: SPA_UNIT,
      status: 'active',
    });
    if (error) throw error;
  }

  // ---- Service items
  console.log('  · service_items');
  const items = [
    { code: 'M60T', name: 'Thai Massage 60min', cat: 'MASSAGE', duration: 60 },
    { code: 'M90T', name: 'Thai Massage 90min', cat: 'MASSAGE', duration: 90 },
    { code: 'M120T', name: 'Thai Massage 120min', cat: 'MASSAGE', duration: 120 },
    { code: 'M60C', name: 'Combination 60min', cat: 'MASSAGE', duration: 60 },
    { code: 'M90C', name: 'Combination 90min', cat: 'MASSAGE', duration: 90 },
    { code: 'M60F', name: 'Filipino Traditional 60min', cat: 'MASSAGE', duration: 60 },
    { code: 'M90F', name: 'Filipino Traditional 90min', cat: 'MASSAGE', duration: 90 },
    { code: 'H_CUT', name: 'Hair Cut', cat: 'HAIR', duration: 45, resource: 'hair_chair', prep: 3, cleanup: 5 },
    { code: 'REST60', name: 'Rest Room 60min', cat: 'REST', duration: 60, resource: 'rest_room', prep: 5, cleanup: 10, commission: false, tip: false },
    { code: 'REST120', name: 'Rest Room 120min', cat: 'REST', duration: 120, resource: 'rest_room', prep: 5, cleanup: 10, commission: false, tip: false },
  ];
  // Strip trailing " NNmin" so siblings ("Thai Massage 60min" / 90min) share
  // a group; items with no duration suffix (e.g. "Hair Cut") get group = name.
  // Matches the migration's regex used to backfill existing rows.
  const groupOf = (name) => name.replace(/\s*\d+\s*min$/i, '').trim();
  for (const it of items) {
    const { error } = await supabase
      .from('service_items')
      .upsert(
        {
          code: it.code,
          name: it.name,
          // Drives the "Skills this therapist can perform" picker on the
          // Employees page; NULL group → silently dropped from the picker.
          service_group: groupOf(it.name),
          service_category_id: categoryId[it.cat],
          duration_minutes: it.duration,
          prep_before_minutes: it.prep ?? 10,
          cleanup_after_minutes: it.cleanup ?? 15,
          required_resource_type: it.resource ?? 'massage_bed',
          pricing_model: 'per_session',
          commission_applicable: it.commission ?? true,
          tip_applicable: it.tip ?? true,
          business_unit_id: SPA_UNIT,
          active: true,
        },
        { onConflict: 'code' },
      );
    if (error) throw error;
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
