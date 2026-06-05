#!/usr/bin/env node
// Add chair stations to HSPA2: 2F x6, 3F x5. Idempotent on resource_name within branch.
// Usage: node scripts/add-hspa2-chairs.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const HSPA2 = '7ed648b1-dc4d-469d-a3e4-c072bf6dd458';
const SPA = '8e55dec0-a6e6-414b-8a1b-4d382d825fc2';

const plan = [
  ...Array.from({ length: 6 }, (_, i) => ({ zone: '2F', name: `2F Chair ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ zone: '3F', name: `3F Chair ${i + 1}` })),
];

// skip any names that already exist in this branch
const existing = await s.from('resources').select('resource_name').eq('branch_id', HSPA2);
if (existing.error) throw existing.error;
const have = new Set(existing.data.map((r) => r.resource_name));
const rows = plan
  .filter((p) => !have.has(p.name))
  .map((p) => ({
    branch_id: HSPA2,
    resource_type: 'chair',
    resource_name: p.name,
    location_zone: p.zone,
    capacity: 1,
    business_unit_id: SPA,
    status: 'active',
  }));

if (!rows.length) { console.log('Nothing to add — all chairs already exist.'); process.exit(0); }
const ins = await s.from('resources').insert(rows).select('resource_name, location_zone');
if (ins.error) throw ins.error;
console.log(`Added ${ins.data.length} chairs to HSPA2:`);
for (const r of ins.data) console.log(`  [${r.location_zone}] ${r.resource_name}`);