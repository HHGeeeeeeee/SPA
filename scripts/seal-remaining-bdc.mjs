import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const todayPHT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const now = new Date().toISOString();
const { data: bdc } = await sb.from('business_day_close').select('id, business_date, status, branch:branches!business_day_close_branch_id_fkey ( code )').lt('business_date', todayPHT).neq('status', 'closed');
console.log(`Found ${bdc?.length ?? 0} remaining open bdc rows`);
for (const r of bdc ?? []) {
  await sb.from('business_day_close').update({ status: 'closed', closed_at: now, order_reviewed_at: now, balances_ok_at: now, revenue_confirmed_at: now, note: 'Test data cleanup — bypass ERP' }).eq('id', r.id);
  const br = Array.isArray(r.branch) ? r.branch[0] : r.branch;
  console.log(`  ✓ ${r.business_date} ${br?.code} → closed`);
}
// final verify
const { data: stillOpen } = await sb.from('business_day_close').select('business_date').lt('business_date', todayPHT).neq('status', 'closed');
console.log(`\nRemaining open past days: ${stillOpen?.length ?? 0}`);
const { data: arRow } = await sb.from('payment_methods').select('id').eq('code', 'ar').single();
const { data: stillPending } = await sb.from('orders').select('order_no, status, service_date, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )').lt('service_date', todayPHT).is('deleted_at', null).in('status', ['paid', 'completed']);
const remaining = (stillPending ?? []).filter(o => { const bd = Array.isArray(o.billing) ? o.billing[0] : o.billing; return o.status === 'paid' || (o.status === 'completed' && bd?.default_payment_method_id === arRow.id); });
console.log(`Remaining pending orders: ${remaining.length}`);
process.exit(0);
