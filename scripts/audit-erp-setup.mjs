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

console.log('=== Branch OSP2 ===');
const { data: br } = await sb.from('branches').select('id, code, name').eq('code', 'OSP2').single();
console.log(br);
if (!br) { process.exit(1); }
const branchId = br.id;

console.log('\n=== Payment methods (global) ===');
const { data: pms } = await sb.from('payment_methods').select('id, code, name, kind, credit_account, sub_account_pattern, is_active').order('code');
for (const p of pms ?? []) {
  console.log(`  ${p.code.padEnd(14)} | kind=${(p.kind||'').padEnd(10)} | credit=${p.credit_account ?? '—'} | sub=${p.sub_account_pattern ?? '—'} | active=${p.is_active}`);
}

console.log('\n=== Transaction codes for OSP2 ===');
const { data: tcs } = await sb.from('transaction_codes')
  .select('transaction_type, payment_method:payment_methods(code), debit_account, credit_account, sub_account, description, is_active')
  .eq('branch_id', branchId).order('transaction_type');
if (!tcs?.length) {
  console.log('  ⚠ NO transaction codes set for OSP2 — must seed before ERP can run');
} else {
  for (const t of tcs) {
    const pm = Array.isArray(t.payment_method) ? t.payment_method[0] : t.payment_method;
    console.log(`  ${t.transaction_type.padEnd(20)} | pm=${(pm?.code||'—').padEnd(14)} | DR ${t.debit_account ?? '—'} | CR ${t.credit_account} | sub=${t.sub_account ?? '—'} | active=${t.is_active}`);
  }
}

console.log('\n=== Billing destinations using OSP2 ===');
const { data: bds } = await sb.from('billing_destinations').select('code, name, settlement_type, ar_account, credit_terms_days, intercompany_account').order('code');
for (const b of bds ?? []) {
  console.log(`  ${b.code.padEnd(14)} | ${b.settlement_type.padEnd(13)} | AR=${b.ar_account ?? '—'} | terms=${b.credit_terms_days}d | intercompany=${b.intercompany_account ?? '—'}`);
}

console.log('\n=== Open Tip Settlements for OSP2 (candidates to push) ===');
const { data: tipS } = await sb.from('tip_settlements')
  .select('id, settlement_no, status, subtotal_cents, posting_status, gl_batch_nbr, period_from, period_to')
  .eq('branch_id', branchId)
  .order('created_at', { ascending: false }).limit(8);
for (const s of tipS ?? []) {
  console.log(`  ${s.settlement_no.padEnd(36)} | ${s.status.padEnd(10)} | ${(s.posting_status ?? 'null').padEnd(10)} | bill=${s.gl_batch_nbr ?? '—'} | ${(s.subtotal_cents/100).toFixed(2).padStart(10)} | ${s.period_from}~${s.period_to}`);
}

console.log('\n=== Recent paid orders at OSP2 (revenue confirm candidates) ===');
const { data: ords } = await sb.from('orders')
  .select('id, order_no, status, service_date, revenue_posting_status, revenue_gl_batch_nbr')
  .eq('branch_id', branchId)
  .in('status', ['paid', 'closed'])
  .order('service_date', { ascending: false }).limit(5);
for (const o of ords ?? []) {
  console.log(`  ${o.order_no.padEnd(28)} | ${o.status.padEnd(8)} | ${o.service_date} | posting=${o.revenue_posting_status ?? 'null'} | batch=${o.revenue_gl_batch_nbr ?? '—'}`);
}
process.exit(0);
