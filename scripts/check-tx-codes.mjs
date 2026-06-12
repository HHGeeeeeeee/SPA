#!/usr/bin/env node
// One-off: list transaction_codes + their bindings (payment methods / branch
// defaults / billing destinations) to confirm what's actually configured live.
// Usage: node scripts/check-tx-codes.mjs

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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data, error } = await supabase
  .from('transaction_codes')
  .select('id, code, transaction_type, debit_account, debit_subaccount, debit_branch_id, credit_account, credit_subaccount, credit_branch_id, active')
  .order('code');
if (error) { console.error(error); process.exit(1); }

console.log(`Found ${data.length} transaction_codes:\n`);
for (const t of data) {
  console.log(
    `${t.code.padEnd(24)} | ${String(t.transaction_type).padEnd(8)} | DR ${t.debit_account ?? '—'}/${t.debit_subaccount ?? '—'}${t.debit_branch_id ? `@${t.debit_branch_id}` : ''} | CR ${t.credit_account ?? '—'}/${t.credit_subaccount ?? '—'}${t.credit_branch_id ? `@${t.credit_branch_id}` : ''} | ${t.active ? 'active' : 'inactive'}`,
  );
}

const codeName = Object.fromEntries(data.map((t) => [t.id, t.code]));

const { data: pms } = await supabase.from('payment_methods').select('code, transaction_code_id').order('code');
console.log('\npayment_methods bindings:');
for (const p of pms ?? []) console.log(`  ${p.code.padEnd(20)} → ${codeName[p.transaction_code_id] ?? '—'}`);

const { data: brs } = await supabase.from('branches').select('code, default_revenue_transaction_code_id, default_tip_transaction_code_id, royal_card_transaction_code_id').order('code');
console.log('\nbranch defaults (revenue / tip / royal card):');
for (const b of brs ?? []) console.log(`  ${b.code.padEnd(8)} → ${codeName[b.default_revenue_transaction_code_id] ?? '—'} / ${codeName[b.default_tip_transaction_code_id] ?? '—'} / ${codeName[b.royal_card_transaction_code_id] ?? '—'}`);

const { data: bds } = await supabase.from('billing_destinations').select('code, transaction_code_id').order('code');
console.log('\nbilling_destinations bindings:');
for (const b of bds ?? []) console.log(`  ${b.code.padEnd(12)} → ${codeName[b.transaction_code_id] ?? '—'}`);

process.exit(0);
