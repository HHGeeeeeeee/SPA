import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

console.log('=== 1. Tip Settlement → AP Bill ===');
const { data: tips } = await sb.from('tip_settlements')
  .select('settlement_no, status, posting_status, gl_batch_nbr, subtotal_cents')
  .order('settlement_no', { ascending: false }).limit(8);
for (const t of tips ?? []) {
  console.log(`  ${t.settlement_no.padEnd(28)} status=${t.status.padEnd(10)} posting=${(t.posting_status ?? '-').padEnd(8)} Bill=${t.gl_batch_nbr ?? '—'} (₱${t.subtotal_cents/100})`);
}

console.log('\n=== 2. Revenue Confirm → GL Journal (orders by gl_batch_nbr) ===');
const { data: bcOrders } = await sb.from('orders').select('gl_batch_nbr, service_date, branch:branches(code)').not('gl_batch_nbr', 'is', null).order('gl_batch_nbr');
const byBatch = new Map();
for (const o of bcOrders ?? []) {
  const k = o.gl_batch_nbr;
  const br = (Array.isArray(o.branch) ? o.branch[0] : o.branch)?.code ?? '?';
  if (!byBatch.has(k)) byBatch.set(k, { date: o.service_date, br, n: 0 });
  byBatch.get(k).n += 1;
}
for (const [batch, v] of [...byBatch].sort()) {
  console.log(`  GL #${batch}  ${v.br} ${v.date}  ${v.n} order(s)`);
}

console.log('\n=== 3. SOA Intercompany Settle ===');
const { data: soas } = await sb.from('revenue_soa').select('soa_no, status, settlement_type, period_from, period_to, total_cents, gl_batch_nbr, posting_status')
  .order('soa_no', { ascending: false }).limit(15);
for (const s of soas ?? []) {
  console.log(`  ${s.soa_no.padEnd(32)} ${s.settlement_type.padEnd(13)} ${s.status.padEnd(11)} GL=${s.gl_batch_nbr ?? '—'} ${s.period_from}~${s.period_to} ₱${s.total_cents/100}`);
}

console.log('\n=== 4. SOA Third-party Payment ===');
const { data: pays } = await sb.from('revenue_soa_payments').select('id, amount_cents, payment_method, paid_at, posting_status, gl_batch_nbr')
  .order('paid_at', { ascending: false }).limit(8);
for (const p of pays ?? []) console.log(`  ${p.paid_at.slice(0,10)} ${p.payment_method ?? '?'} ₱${p.amount_cents/100}  posting=${p.posting_status ?? '-'}  GL=${p.gl_batch_nbr ?? '—'}`);

console.log('\n=== ERP posting log (last 10) ===');
const { data: logs } = await sb.from('erp_posting_log').select('entity_type, status, batch_nbr, error_message').order('created_at', { ascending: false }).limit(10);
for (const l of logs ?? []) console.log(`  ${l.entity_type.padEnd(22)} ${l.status.padEnd(10)} batch=${l.batch_nbr ?? '-'} ${l.error_message ? ' err='+l.error_message.slice(0,60) : ''}`);

process.exit(0);
