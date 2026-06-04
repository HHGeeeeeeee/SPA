#!/usr/bin/env node
// One-off: clear the resources table and re-seed the physical stations for
// HSPA1 + HSPA2 per the official floor plan. Existing rows are pre-prod test
// data; one is linked from reservation_resources (ON DELETE CASCADE), so the
// wipe also drops that test link. Usage: node scripts/reseed-resources.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envText = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// Floor plan:
//   HSPA1  1F: 4 nail/massage chairs
//          2F: 9 beds
//   HSPA2  1F: 4 hairwash beds
//          2F: 6 beds + couple room (2 beds)
//          3F: 6 beds + 2 facial beds + couple room (2 beds)
// Couple-room beds are modelled as 2 independent massage_beds (zone tagged).
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const PLAN = [
  // HSPA1
  ...range(4).map((i) => ({ branch: 'HSPA1', type: 'chair', name: `1F Chair ${i}`, zone: '1F' })),
  ...range(9).map((i) => ({ branch: 'HSPA1', type: 'massage_bed', name: `2F Bed ${i}`, zone: '2F' })),
  // HSPA2
  ...range(4).map((i) => ({ branch: 'HSPA2', type: 'hairwash_bed', name: `1F Hairwash ${i}`, zone: '1F' })),
  ...range(6).map((i) => ({ branch: 'HSPA2', type: 'massage_bed', name: `2F Bed ${i}`, zone: '2F' })),
  ...range(2).map((i) => ({ branch: 'HSPA2', type: 'massage_bed', name: `2F Couple Bed ${i}`, zone: '2F Couple Room' })),
  ...range(6).map((i) => ({ branch: 'HSPA2', type: 'massage_bed', name: `3F Bed ${i}`, zone: '3F' })),
  ...range(2).map((i) => ({ branch: 'HSPA2', type: 'facial_bed', name: `3F Facial Bed ${i}`, zone: '3F' })),
  ...range(2).map((i) => ({ branch: 'HSPA2', type: 'massage_bed', name: `3F Couple Bed ${i}`, zone: '3F Couple Room' })),
];

async function main() {
  console.log('Re-seeding resources from floor plan…');

  const { data: branches, error: be } = await s.from('branches').select('id, code');
  if (be) throw be;
  const branchId = Object.fromEntries(branches.map((b) => [b.code, b.id]));
  for (const code of ['HSPA1', 'HSPA2']) {
    if (!branchId[code]) throw new Error(`branch ${code} not found`);
  }

  const { data: bu, error: bue } = await s.from('business_units').select('id').eq('code', 'spa').single();
  if (bue) throw bue;
  const SPA_UNIT = bu.id;

  // resources.id is referenced by reservation_resources with ON DELETE RESTRICT,
  // so clear those pins first. They are optional bed-pins on (test) reservations;
  // removing a pin just makes the reservation unassigned demand again.
  const { data: pins, error: pe } = await s.from('reservation_resources').select('reservation_id');
  if (pe) throw pe;
  if (pins.length) {
    console.log(`  · clearing ${pins.length} reservation resource pin(s)`);
    const { error: pde } = await s.from('reservation_resources').delete().not('reservation_id', 'is', null);
    if (pde) throw pde;
  }

  const { data: existing, error: le } = await s.from('resources').select('id');
  if (le) throw le;
  console.log(`  · deleting ${existing.length} existing resources`);
  const { error: de } = await s.from('resources').delete().not('id', 'is', null);
  if (de) throw de;

  const rows = PLAN.map((r) => ({
    branch_id: branchId[r.branch],
    resource_type: r.type,
    resource_name: r.name,
    location_zone: r.zone,
    capacity: 1,
    business_unit_id: SPA_UNIT,
    status: 'active',
  }));

  console.log(`  · inserting ${rows.length} resources`);
  const { error: ie } = await s.from('resources').insert(rows);
  if (ie) throw ie;

  // Summary by branch + type
  const summary = {};
  for (const r of PLAN) {
    const k = `${r.branch} / ${r.type}`;
    summary[k] = (summary[k] || 0) + 1;
  }
  console.log('Done:');
  for (const [k, n] of Object.entries(summary)) console.log(`    ${k}: ${n}`);
}

main().catch((err) => {
  console.error('Reseed failed:', err);
  process.exit(1);
});
