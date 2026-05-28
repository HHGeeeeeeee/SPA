import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const todayPHT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
console.log(`Today PHT = ${todayPHT}\n`);

const { data: arRow } = await sb.from('payment_methods').select('id').eq('code', 'ar').single();
const arId = arRow.id;

const { data: orders } = await sb.from('orders')
  .select('id, order_no, branch_id, status, service_date, total_cents, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id ), branch:branches!orders_branch_id_fkey ( code )')
  .lt('service_date', todayPHT)
  .is('deleted_at', null)
  .in('status', ['paid', 'completed']);

const pending = (orders ?? []).filter(o => {
  const bd = Array.isArray(o.billing) ? o.billing[0] : o.billing;
  const isAR = bd?.default_payment_method_id === arId;
  return o.status === 'paid' || (o.status === 'completed' && isAR);
});

console.log(`=== Orders pending close (service_date < today) ===`);
console.log(`Total: ${pending.length} orders\n`);

const byBranchDate = new Map();
for (const o of pending) {
  const br = (Array.isArray(o.branch) ? o.branch[0] : o.branch)?.code ?? '?';
  const k = `${br}|${o.service_date}|${o.status}`;
  byBranchDate.set(k, (byBranchDate.get(k) ?? { n: 0, c: 0 }));
  byBranchDate.get(k).n += 1; byBranchDate.get(k).c += o.total_cents;
}
for (const [k, v] of [...byBranchDate].sort()) console.log(`  ${k.padEnd(30)} ${String(v.n).padStart(3)} order(s) · ₱${(v.c/100).toLocaleString('en-PH', {minimumFractionDigits:2})}`);

console.log('\n=== business_day_close (past, not closed) ===');
const { data: bdc } = await sb.from('business_day_close')
  .select('business_date, status, branch:branches!business_day_close_branch_id_fkey ( code, id )')
  .lt('business_date', todayPHT)
  .neq('status', 'closed')
  .order('business_date', { ascending: true });
for (const r of bdc ?? []) {
  const br = (Array.isArray(r.branch) ? r.branch[0] : r.branch);
  console.log(`  ${r.business_date} ${(br?.code ?? '?').padEnd(8)} ${r.status}`);
}

console.log('\n=== Branches with NO bdc row for past dates that have orders ===');
const datesWithOrders = new Set();
for (const o of pending) datesWithOrders.add(`${o.branch_id}|${o.service_date}`);
const datesWithBdc = new Set((bdc ?? []).map(r => `${(Array.isArray(r.branch)?r.branch[0]:r.branch)?.id}|${r.business_date}`));
// Find dates with orders that have NO bdc row at all
const allBdc = await sb.from('business_day_close').select('branch_id, business_date').lt('business_date', todayPHT);
const allBdcKey = new Set((allBdc.data ?? []).map(r => `${r.branch_id}|${r.business_date}`));
let noBdc = 0;
for (const k of datesWithOrders) if (!allBdcKey.has(k)) noBdc += 1;
console.log(`  ${noBdc} branch×date combos have pending orders but no business_day_close row`);

process.exit(0);
