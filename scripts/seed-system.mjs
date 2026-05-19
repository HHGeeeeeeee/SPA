#!/usr/bin/env node
// Phase 4 seed: system settings + initial admin user.
// Usage: node scripts/seed-system.mjs

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
  console.log('Phase 4 seed: settings + admin user…');

  // ---- System settings (magic numbers)
  console.log('  · settings');
  const settings = [
    { key: 'manager_max_discount_percent', value: '30', value_type: 'integer', description: 'Max % a Manager-role user can apply as DIS-91 / DIS-99 without admin' },
    { key: 'posting_timeout_seconds', value: '60', value_type: 'integer', description: 'Acumatica GL push timeout. After this, ERPPostingLog flips to unknown.' },
    { key: 'soa_default_due_days_third_party', value: '30', value_type: 'integer', description: 'Default credit terms (days) for Third-Party SOA. Intercompany ignores.' },
    { key: 'reservation_no_show_minutes', value: '30', value_type: 'integer', description: 'Mins past desired_service_start before auto-marking reservation as no_show' },
    { key: 'stored_value_default_expiry_days', value: '365', value_type: 'integer', description: 'Default expiry days for newly issued Stored Value Cards' },
    { key: 'exception_void_threshold_per_month', value: '5', value_type: 'integer', description: 'Highlight on Dashboard when monthly Void count exceeds this' },
    { key: 'exception_dis90_threshold_per_month', value: '3', value_type: 'integer', description: 'Highlight when DIS-90 (客訴 100%) usage exceeds this monthly' },
    { key: 'feedback_score_warning_threshold', value: '3', value_type: 'integer', description: 'Score ≤ this triggers manager notification on submit' },
    { key: 'default_prep_minutes_massage', value: '10', value_type: 'integer', description: 'Default prep minutes for new Massage service items' },
    { key: 'default_cleanup_minutes_massage', value: '15', value_type: 'integer', description: 'Default cleanup minutes for new Massage service items' },
    { key: 'manager_pin_lockout_minutes', value: '15', value_type: 'integer', description: 'Lockout duration after 5 failed Manager PIN attempts' },
    { key: 'manager_pin_max_failed_attempts', value: '5', value_type: 'integer', description: 'Failed PIN attempts before lockout' },
  ];
  for (const s of settings) {
    const { error } = await supabase.from('settings').upsert(
      { ...s, scope: 'global', branch_id: null },
      { onConflict: 'key,branch_id' },
    );
    if (error) throw error;
  }

  // ---- Sample admin user
  console.log('  · admin user');
  const { error: ue } = await supabase.from('staff_users').upsert(
    {
      email: 'admin@acumatica.local',
      acumatica_user_id: 'admin',
      display_name: 'System Admin',
      role: 'admin',
      active: true,
    },
    { onConflict: 'acumatica_user_id' },
  );
  if (ue) throw ue;

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
