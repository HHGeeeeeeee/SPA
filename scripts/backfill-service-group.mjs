// One-off backfill: service_items inserted after the
// 20260520125133_service_group migration have service_group = NULL because the
// migration's UPDATE only ran once. The employees page's "skills" picker
// derives its list from DISTINCT service_group, so NULL items silently vanish
// from that picker — therapists can never be marked as able to perform them.
//
// Fix: re-run the same name-strip the migration used, but only for rows that
// still have a NULL group. Safe to re-run.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// Strip a trailing " NNmin" (case-insensitive) from the name, same rule the
// migration uses; "Manicure" stays "Manicure", "Thai Massage 90min" → "Thai Massage".
const stripDuration = (name) => name.replace(/\s*\d+\s*min$/i, '').trim();

const { data: nullGroups } = await sb.from('service_items')
  .select('id, code, name, service_group, active')
  .is('service_group', null);

console.log(`Found ${(nullGroups ?? []).length} item(s) with NULL service_group:`);
for (const it of nullGroups ?? []) {
  const group = stripDuration(it.name);
  if (!group) { console.log(`  · ${it.code} ${it.name} — name is empty after strip, skip`); continue; }
  const { error } = await sb.from('service_items').update({ service_group: group }).eq('id', it.id);
  if (error) { console.error(`  ✗ ${it.code}: ${error.message}`); continue; }
  console.log(`  ✓ ${it.code.padEnd(8)} ${it.name.padEnd(20)} → service_group = "${group}"`);
}

console.log('\nDone.');
process.exit(0);
