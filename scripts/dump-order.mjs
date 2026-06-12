#!/usr/bin/env node
// One-off: dump an order's money picture (totals, per-guest items, folio lines)
// to debug payment caps. Usage: node scripts/dump-order.mjs <order_id>

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

const orderId = process.argv[2];
if (!orderId) { console.error('usage: node scripts/dump-order.mjs <order_id>'); process.exit(1); }

const { data: o } = await supabase.from('orders').select('order_no, status, subtotal_cents, discount_cents, total_cents, paid_cents').eq('id', orderId).single();
console.log('order:', o);

const { data: custs } = await supabase.from('order_customers').select('id, seq_no, customer_name').eq('order_id', orderId).order('seq_no');
const name = new Map((custs ?? []).map((c) => [c.id, `#${c.seq_no} ${c.customer_name}`]));
console.log('\nguests:', (custs ?? []).map((c) => `${c.id.slice(0, 8)} = #${c.seq_no} ${c.customer_name}`).join(' | '));

const { data: items } = await supabase
  .from('order_items')
  .select('id, order_customer_id, status, list_price_cents, discount_amount_cents, final_amount_cents, service:service_items ( name )')
  .eq('order_id', orderId);
console.log('\norder_items:');
for (const it of items ?? []) {
  const svc = Array.isArray(it.service) ? it.service[0] : it.service;
  console.log(`  ${name.get(it.order_customer_id) ?? '(no guest)'} | ${svc?.name ?? '—'} | ${it.status} | list=${it.list_price_cents} disc=${it.discount_amount_cents} final=${it.final_amount_cents}`);
}

const { data: lines } = await supabase
  .from('folio_lines')
  .select('kind, amount_cents, order_customer_id, order_item_id, note, method:payment_methods ( code )')
  .eq('order_id', orderId)
  .order('posted_at');
console.log('\nfolio_lines:');
for (const l of lines ?? []) {
  const m = Array.isArray(l.method) ? l.method[0] : l.method;
  console.log(`  ${l.kind.padEnd(8)} ${String(l.amount_cents).padStart(8)} | guest=${name.get(l.order_customer_id) ?? '—'} | item=${l.order_item_id ? 'yes' : '—'} | ${m?.code ?? ''} ${l.note ?? ''}`);
}

// Reproduce the per-guest cap math from takePayment for every guest.
console.log('\nper-guest cap (custSubtotal - custPaid):');
for (const c of custs ?? []) {
  const sub = (items ?? []).filter((i) => i.order_customer_id === c.id && !['cancelled', 'no_show'].includes(i.status)).reduce((s, i) => s + (i.final_amount_cents ?? 0), 0);
  const paid = (lines ?? []).filter((l) => l.order_customer_id === c.id && ['payment', 'refund', 'tip'].includes(l.kind)).reduce((s, l) => s + (l.kind === 'payment' ? l.amount_cents : -l.amount_cents), 0);
  console.log(`  ${name.get(c.id)}: subtotal=${sub} paid=${paid} due=${Math.max(0, sub - paid)}`);
}
process.exit(0);
