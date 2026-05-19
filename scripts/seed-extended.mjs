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

  const { data: branches } = await supabase.from('branches').select('id, code');
  const { data: categories } = await supabase.from('service_categories').select('id, code');
  const { data: classes } = await supabase.from('commission_classes').select('id, class_code');

  const byCode = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.id]));
  const branchId = byCode(branches ?? [], 'code');
  const categoryId = byCode(categories ?? [], 'code');
  const classId = byCode(classes ?? [], 'class_code');

  if (!branchId.OSP2 || !categoryId.MASSAGE || !classId.J) {
    throw new Error('Phase 1 seed missing required rows (OSP2 / MASSAGE / J)');
  }

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
  for (const r of resourceRows) {
    const { error } = await supabase
      .from('resources')
      .upsert(
        {
          branch_id: branchId[r.branch],
          resource_type: r.type,
          resource_name: r.name,
          location_zone: r.zone,
          capacity: r.capacity,
          business_unit: 'spa',
          status: 'active',
        },
        { onConflict: 'branch_id,resource_name', ignoreDuplicates: true },
      );
    if (error && !/duplicate|unique/i.test(error.message)) throw error;
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
  for (const e of employees) {
    const { error } = await supabase
      .from('employees')
      .upsert(
        {
          employee_code: e.code,
          name: e.name,
          phone: e.phone,
          gender: e.gender,
          home_branch_id: branchId[e.branch],
          commission_class_id: classId[e.class],
          position: 'Massage Therapist',
          business_unit: 'spa',
          status: 'active',
        },
        { onConflict: 'employee_code' },
      );
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
  for (const it of items) {
    const { error } = await supabase
      .from('service_items')
      .upsert(
        {
          code: it.code,
          name: it.name,
          service_category_id: categoryId[it.cat],
          duration_minutes: it.duration,
          prep_before_minutes: it.prep ?? 10,
          cleanup_after_minutes: it.cleanup ?? 15,
          required_resource_type: it.resource ?? 'massage_bed',
          pricing_model: 'per_session',
          commission_applicable: it.commission ?? true,
          tip_applicable: it.tip ?? true,
          business_unit: 'spa',
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
