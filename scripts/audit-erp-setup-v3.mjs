import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envText = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()];
  })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data: br } = await sb.from('branches').select('id, code, name').eq('code', 'OSP2').single();
const OSP2 = br.id;

console.log('=== ALL transaction_codes (by branch) ===');
const { data: all } = await sb.from('transaction_codes')
  .select('code, branch:branches(code), transaction_type, payment_method:payment_methods(code), debit_account, debit_subaccount, credit_account, credit_subaccount, active')
  .order('transaction_type');
for (const t of all ?? []) {
  const br = Array.isArray(t.branch) ? t.branch[0] : t.branch;
  const pm = Array.isArray(t.payment_method) ? t.payment_method[0] : t.payment_method;
  console.log(`  [${br?.code ?? '—'}] ${(t.code||'').padEnd(20)} | ${t.transaction_type.padEnd(20)} | pm=${(pm?.code||'—').padEnd(14)} | DR ${(t.debit_account||'—').padEnd(8)}/${t.debit_subaccount||'—'} | CR ${(t.credit_account||'—').padEnd(8)}/${t.credit_subaccount||'—'}`);
}

console.log('\n=== transaction_codes ONLY OSP2 ===');
const { data: osp2 } = await sb.from('transaction_codes')
  .select('code, transaction_type, payment_method:payment_methods(code), debit_account, debit_subaccount, credit_account, credit_subaccount, active')
  .eq('branch_id', OSP2)
  .order('transaction_type');
console.log(`  OSP2 has ${osp2?.length ?? 0} rows`);
for (const t of osp2 ?? []) {
  const pm = Array.isArray(t.payment_method) ? t.payment_method[0] : t.payment_method;
  console.log(`  ${(t.code||'').padEnd(20)} | ${t.transaction_type.padEnd(20)} | pm=${(pm?.code||'—').padEnd(14)} | DR ${(t.debit_account||'—').padEnd(8)}/${t.debit_subaccount||'—'} | CR ${(t.credit_account||'—').padEnd(8)}/${t.credit_subaccount||'—'}`);
}

// Distinct transaction_type values
console.log('\n=== distinct transaction_type values in table ===');
const seen = new Set();
for (const t of all ?? []) seen.add(t.transaction_type);
console.log([...seen]);
process.exit(0);
