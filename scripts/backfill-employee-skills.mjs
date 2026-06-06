#!/usr/bin/env node
// Grant EVERY employee EVERY service_group skill. Idempotent: upsert on the
// (employee_id, service_group) unique constraint, ignoring existing rows.
// Usage: node scripts/backfill-employee-skills.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// All employees (every status).
const { data: emps, error: ee } = await s.from('employees').select('id, name');
if (ee) throw ee;

// Distinct, non-null service groups across all service items.
const { data: items, error: ie } = await s.from('service_items').select('service_group');
if (ie) throw ie;
const groups = [...new Set((items ?? []).map((i) => i.service_group).filter(Boolean))].sort();

console.log(`Employees: ${emps.length}  ·  Service groups: ${groups.length}`);
console.log('Groups:', JSON.stringify(groups));

const rows = [];
for (const e of emps) for (const g of groups) rows.push({ employee_id: e.id, service_group: g });
console.log(`Pairs to upsert: ${rows.length}`);

// Upsert in chunks; ignoreDuplicates relies on the (employee_id, service_group)
// UNIQUE constraint so re-runs are no-ops.
let inserted = 0;
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const { error, count } = await s
    .from('employee_service_groups')
    .upsert(chunk, { onConflict: 'employee_id,service_group', ignoreDuplicates: true, count: 'exact' });
  if (error) throw error;
  inserted += count ?? 0;
}
const { count: total } = await s.from('employee_service_groups').select('*', { count: 'exact', head: true });
console.log(`Done. Newly inserted (approx): ${inserted}. Total rows now: ${total}.`);
