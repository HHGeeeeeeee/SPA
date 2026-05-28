// One-off: close all paid / AR-completed orders with service_date < today
// WITHOUT pushing to Acumatica. This is a test-data cleanup — it bypasses
// the normal Revenue Confirm flow (which would post GL). Use only when
// the test data is unblocking your test scenarios, not for real books.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const todayPHT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const now = new Date().toISOString();

// --- 1. Find all pending orders ---
const { data: arRow } = await sb.from('payment_methods').select('id').eq('code', 'ar').single();
const arId = arRow.id;
const { data: orders } = await sb.from('orders')
  .select('id, order_no, branch_id, status, service_date, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
  .lt('service_date', todayPHT).is('deleted_at', null).in('status', ['paid', 'completed']);
const pending = (orders ?? []).filter(o => {
  const bd = Array.isArray(o.billing) ? o.billing[0] : o.billing;
  return o.status === 'paid' || (o.status === 'completed' && bd?.default_payment_method_id === arId);
});

console.log(`Found ${pending.length} pending orders to close.\n`);

// --- 2. Close orders (bypass ERP) + write status log ---
let closed = 0;
for (const o of pending) {
  const { error } = await sb.from('orders')
    .update({ status: 'closed', posting_status: null, posting_error: null })
    .eq('id', o.id);
  if (error) { console.log(`  ✗ ${o.order_no}: ${error.message}`); continue; }
  await sb.from('order_status_log').insert({
    entity_type: 'order', entity_id: o.id,
    from_status: o.status, to_status: 'closed',
    reason: 'Test data cleanup — bypass ERP', changed_at: now,
  });
  closed += 1;
  console.log(`  ✓ ${o.order_no} (${o.service_date}, ${o.status} → closed)`);
}

// --- 3. Mark all past business_day_close rows as closed ---
const branchDates = new Set();
for (const o of pending) branchDates.add(`${o.branch_id}|${o.service_date}`);

let bdcClosed = 0;
for (const k of branchDates) {
  const [branchId, date] = k.split('|');
  // Upsert: if exists update; else create as closed with all timestamps backfilled
  const { data: existing } = await sb.from('business_day_close')
    .select('id, status').eq('branch_id', branchId).eq('business_date', date).maybeSingle();
  if (existing) {
    if (existing.status === 'closed') continue;
    await sb.from('business_day_close').update({
      status: 'closed', closed_at: now,
      order_reviewed_at: now, balances_ok_at: now, revenue_confirmed_at: now,
      note: 'Test data cleanup — bypass ERP',
    }).eq('id', existing.id);
    bdcClosed += 1;
    console.log(`  ✓ business_day_close ${date} branch=${branchId.slice(0,8)} updated → closed`);
  } else {
    const { error } = await sb.from('business_day_close').insert({
      branch_id: branchId, business_date: date,
      status: 'closed', opened_at: now, closed_at: now,
      order_reviewed_at: now, balances_ok_at: now, revenue_confirmed_at: now,
      note: 'Test data cleanup — bypass ERP',
    });
    if (error) { console.log(`  ✗ bdc ${date}: ${error.message}`); continue; }
    bdcClosed += 1;
    console.log(`  ✓ business_day_close ${date} branch=${branchId.slice(0,8)} created → closed`);
  }
}

console.log(`\nDone. Closed ${closed} order(s), sealed ${bdcClosed} business day(s).`);
process.exit(0);
