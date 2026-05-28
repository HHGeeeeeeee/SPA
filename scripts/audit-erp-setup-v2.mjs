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

console.log('=== payment_methods (raw) ===');
const { data: pms, error: pmErr } = await sb.from('payment_methods').select('*').order('code');
if (pmErr) console.log('error:', pmErr);
console.log('count:', pms?.length ?? 0);
if (pms?.[0]) console.log('first row columns:', Object.keys(pms[0]).join(', '));
for (const p of pms ?? []) {
  console.log(`  ${p.code}: ${JSON.stringify(p)}`);
}

console.log('\n=== billing_destinations (raw) ===');
const { data: bds, error: bdErr } = await sb.from('billing_destinations').select('*').order('code');
if (bdErr) console.log('error:', bdErr);
console.log('count:', bds?.length ?? 0);
if (bds?.[0]) console.log('first row columns:', Object.keys(bds[0]).join(', '));
for (const b of bds ?? []) {
  console.log(`  ${b.code}: settlement_type=${b.settlement_type}, ar_account=${b.ar_account}, intercompany_account=${b.intercompany_account}, terms=${b.credit_terms_days}`);
}

console.log('\n=== transaction_codes (raw, all branches) ===');
const { data: tcs, error: tcErr } = await sb.from('transaction_codes').select('*').limit(20);
if (tcErr) console.log('error:', tcErr);
console.log('count:', tcs?.length ?? 0);
if (tcs?.[0]) console.log('first row columns:', Object.keys(tcs[0]).join(', '));
process.exit(0);
