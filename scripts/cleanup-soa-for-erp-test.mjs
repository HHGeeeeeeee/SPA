// One-off cleanup so the new 5/28 AR orders can be folded into fresh SOAs
// and the ERP flows (Intercompany Settle / Third-party Record Payment) can
// finally be tested live.
//
// Actions taken:
//   1. Void the two issued SOAs that are blocking by overlapping period:
//        SOA-202605-HHO-OSP2-002  (HHO intercompany, 5/01–5/28)
//        SOA-202605-THIRD-PARTY-002 (THIRD-PARTY, 5/01–5/25)
//      Same effect as voidSOA(): release the order links + flip status=void.
//
//   2. Reset SOA-202605-HCC-002 from settled → issued so it can re-settle
//      and actually push to Acumatica (it was settled before the ERP wire
//      was hot — gl_batch_nbr is empty). Clear paid_cents, restore
//      outstanding_cents = total_cents. Order links are kept.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const VOIDS = ['SOA-202605-HHO-OSP2-002', 'SOA-202605-THIRD-PARTY-002'];
const RESET = ['SOA-202605-HCC-002'];

console.log('=== Void (issued → void; release order links) ===');
for (const soaNo of VOIDS) {
  const { data: soa } = await sb.from('revenue_soa').select('id, status, total_cents').eq('soa_no', soaNo).maybeSingle();
  if (!soa) { console.log(`  · ${soaNo} not found, skipping`); continue; }
  if (soa.status === 'void') { console.log(`  · ${soaNo} already void`); continue; }
  if (soa.status !== 'issued') { console.log(`  ✗ ${soaNo} status=${soa.status} — refusing (use reversal instead)`); continue; }

  // Release the orders so they can be re-stated on a new SOA.
  await sb.from('revenue_soa_orders').delete().eq('soa_id', soa.id);
  const { error } = await sb.from('revenue_soa').update({ status: 'void' }).eq('id', soa.id);
  if (error) { console.log(`  ✗ ${soaNo}: ${error.message}`); continue; }
  console.log(`  ✓ ${soaNo}  ₱${soa.total_cents / 100} → void (orders released)`);
}

console.log('\n=== Reset (settled → issued; clear payment state, keep order links) ===');
for (const soaNo of RESET) {
  const { data: soa } = await sb.from('revenue_soa').select('id, status, total_cents').eq('soa_no', soaNo).maybeSingle();
  if (!soa) { console.log(`  · ${soaNo} not found, skipping`); continue; }
  if (soa.status === 'issued') { console.log(`  · ${soaNo} already issued`); continue; }

  const { error } = await sb.from('revenue_soa').update({
    status: 'issued',
    paid_cents: 0,
    outstanding_cents: soa.total_cents,
    gl_batch_nbr: null,
    posting_status: null,
    posting_error: null,
  }).eq('id', soa.id);
  if (error) { console.log(`  ✗ ${soaNo}: ${error.message}`); continue; }
  console.log(`  ✓ ${soaNo}  ₱${soa.total_cents / 100} → issued (outstanding restored)`);
}

console.log('\n=== Open SOAs after cleanup ===');
const { data: open } = await sb.from('revenue_soa')
  .select('soa_no, status, settlement_type, period_from, period_to, total_cents')
  .in('status', ['issued', 'partial_paid'])
  .order('soa_no', { ascending: false });
for (const s of open ?? []) {
  console.log(`  ${s.soa_no.padEnd(34)} ${s.settlement_type.padEnd(13)} ${s.status.padEnd(13)} ${s.period_from}~${s.period_to}  ₱${s.total_cents / 100}`);
}

console.log('\nDone.');
process.exit(0);
