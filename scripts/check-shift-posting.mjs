#!/usr/bin/env node
// One-off: recent shifts' ERP posting state + the GL lines the aggregation
// would build, to debug "Sales Remittance didn't post".
// Usage: node scripts/check-shift-posting.mjs

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

const { data: shifts } = await supabase
  .from('shifts')
  .select('id, business_date, label, status, posting_status, gl_batch_nbr, posting_error, branch:branches!shifts_branch_id_fkey ( code )')
  .order('opened_at', { ascending: false })
  .limit(8);

console.log('recent shifts:');
for (const s of shifts ?? []) {
  const b = Array.isArray(s.branch) ? s.branch[0] : s.branch;
  console.log(`  ${s.business_date} ${b?.code ?? '?'} ${String(s.label).padEnd(10)} | ${s.status.padEnd(7)} | posting=${s.posting_status ?? '—'} gl=${s.gl_batch_nbr ?? '—'} ${s.posting_error ? `err=${s.posting_error}` : ''}`);
}

// For the most recent CLOSED shift, rebuild what the aggregation would post.
const closed = (shifts ?? []).find((s) => s.status === 'closed');
if (closed) {
  const { data: lines } = await supabase
    .from('folio_lines')
    .select('amount_cents, kind, dr_branch, cr_branch, code:transaction_codes ( code, debit_account, credit_account )')
    .eq('shift_id', closed.id)
    .not('transaction_code_id', 'is', null);
  console.log(`\nfolio lines of last closed shift (${closed.business_date} ${closed.label}):`);
  for (const l of lines ?? []) {
    const c = Array.isArray(l.code) ? l.code[0] : l.code;
    console.log(`  ${l.kind.padEnd(8)} ${String(l.amount_cents).padStart(8)} | ${c?.code ?? '—'} DR ${c?.debit_account ?? '—'} CR ${c?.credit_account ?? '—'} | dr@${l.dr_branch ?? '—'} cr@${l.cr_branch ?? '—'}`);
  }
}

const { data: logs } = await supabase
  .from('erp_posting_log')
  .select('created_at, entity_type, status, batch_nbr, error_message')
  .order('created_at', { ascending: false })
  .limit(5);
console.log('\nrecent erp_posting_log:');
for (const l of logs ?? []) {
  console.log(`  ${l.created_at} ${l.entity_type.padEnd(18)} ${l.status.padEnd(8)} ${l.batch_nbr ?? '—'} ${l.error_message ?? ''}`);
}
process.exit(0);
