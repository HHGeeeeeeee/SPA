#!/usr/bin/env node
// Phase 3 seed: customer_sources + billing_destinations + transaction_codes
// Run after phase 1 seed.
// Usage: node scripts/seed-billing-sources.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envText = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

async function main() {
  console.log('Phase 3 seed: customer sources + billing + tx codes…');

  const { data: pms } = await supabase.from('payment_methods').select('id, code');
  const pmId = Object.fromEntries((pms ?? []).map((p) => [p.code, p.id]));

  // ---- Billing destinations
  console.log('  · billing_destinations');
  const bd = (overrides) => ({
    settlement_type: 'intercompany',
    intercompany_account: '50170',
    intercompany_sub: '000000T03',
    default_payment_method_id: pmId.ar ?? null,
    credit_terms_days: 0, // intercompany settles by internal cost transfer — no customer due date
    active: true,
    ...overrides,
  });

  const billings = [
    bd({ code: 'HHO', name: 'H Hotel' }),
    bd({ code: 'HSR', name: 'S Resto' }),
    bd({ code: 'HJH', name: 'J Boutique Hotel' }),
    bd({ code: 'HCC', name: 'C Hotel' }),
    bd({ code: 'HZG', name: 'Z Garden' }),
    bd({ code: 'HPCL', name: 'Piece Lio Hotel' }),
    bd({ code: 'HNBV', name: 'Nacpan Beach Villa' }),
    bd({ code: 'HNBR', name: 'Nacpan Beach Resto' }),
    bd({ code: 'HNBG', name: 'Nacpan Beach Glamping' }),
    // ENGO is a THIRD-PARTY partner with 30-day credit terms — orders are
    // AR-billed at service time (the bd() helper default of payment_method=ar
    // is correct, do NOT override). Counter collection is NOT taken; the
    // monthly SOA → Record Payment flow does DR cash/bank / CR AR when the
    // remittance arrives. settlement_type='third_party' (vs intercompany)
    // controls how the SOA's GL is built; default_payment_method_id stays AR.
    bd({
      code: 'ENGO',
      name: 'Elnido Go',
      settlement_type: 'third_party',
      intercompany_account: null,
      intercompany_sub: null,
      credit_terms_days: 30,
    }),
    bd({
      code: 'THIRD-PARTY',
      name: 'Third-Party',
      settlement_type: 'third_party',
      intercompany_account: null,
      intercompany_sub: null,
      credit_terms_days: 30,
    }),
    bd({
      code: 'SELF',
      name: 'Customer Self-Pay',
      settlement_type: 'third_party',
      intercompany_account: null,
      intercompany_sub: null,
      default_payment_method_id: pmId.cash ?? null,
      credit_terms_days: 0,
    }),
  ];
  for (const b of billings) {
    const { error } = await supabase.from('billing_destinations').upsert(b, { onConflict: 'code' });
    if (error) throw error;
  }

  const { data: bds } = await supabase.from('billing_destinations').select('id, code');
  const bdId = Object.fromEntries((bds ?? []).map((b) => [b.code, b.id]));

  // ---- Customer sources
  console.log('  · customer_sources');
  const sources = [
    { code: 'WALK-IN', name: 'Walk-in Customer', billing: 'SELF' },
    { code: 'H-HOTEL', name: 'H Hotel Guest', billing: 'HHO' },
    { code: 'S-RESTO', name: 'S Resto Guest', billing: 'HSR' },
    { code: 'J-HOTEL', name: 'J Boutique Hotel Guest', billing: 'HJH' },
    { code: 'C-HOTEL', name: 'C Hotel Guest', billing: 'HCC' },
    { code: 'HH-VIP', name: 'HH-VIP', billing: 'SELF' },
    { code: 'NACPAN', name: 'Nacpan Beach', billing: 'HNBV' },
    { code: 'ENGO', name: 'Elnido Go', billing: 'ENGO' },
    { code: 'THIRD-PARTY', name: 'Third-Party Customer', billing: 'THIRD-PARTY' },
  ];
  for (const s of sources) {
    const { error } = await supabase.from('customer_sources').upsert(
      {
        code: s.code,
        name: s.name,
        default_billing_to_id: bdId[s.billing] ?? null,
        active: true,
      },
      { onConflict: 'code' },
    );
    if (error) throw error;
  }

  // ---- Transaction codes (global — codes are no longer branch / method scoped;
  // bindings live on payment_methods / billing_destinations / branches)
  console.log('  · transaction_codes');
  const txCodes = [
    // Counter payments (bound on the matching payment method below).
    { code: 'PAYMENT-CASH', transaction_type: 'payment', debit_account: '10108', credit_account: '40140' },
    { code: 'PAYMENT-PAYMAYA', transaction_type: 'payment', debit_account: '10121', credit_account: '40140' },
    // AR 掛帳 (bound on billing destinations).
    { code: 'CHARGE-AR', transaction_type: 'payment', debit_account: '10200', credit_account: '40140' },
    // Royal (stored-value) card redemption (bound per branch).
    { code: 'REDEEM-ROYAL-CARD', transaction_type: 'payment', debit_account: '20510', credit_account: '40140' },
    // Tip (bound per branch). Accounts pending the tip-structure discussion.
    { code: 'TIP-PAYMAYA', transaction_type: 'tip', debit_account: '10121', credit_account: '20500' },
  ];
  for (const tc of txCodes) {
    const { error } = await supabase.from('transaction_codes').upsert(
      { ...tc, branch_id: null, debit_subaccount: '000000000', credit_subaccount: '000000000', active: true },
      { onConflict: 'code,branch_id' },
    );
    if (error) throw error;
  }

  const { data: tcs } = await supabase.from('transaction_codes').select('id, code');
  const tcId = Object.fromEntries((tcs ?? []).map((t) => [t.code, t.id]));

  // Bind payment codes onto their methods (AR / stored value resolve elsewhere).
  const methodBindings = [
    { method: pmId.cash, code: tcId['PAYMENT-CASH'] },
    { method: pmId.paymaya, code: tcId['PAYMENT-PAYMAYA'] },
  ];
  for (const b of methodBindings) {
    if (!b.method || !b.code) continue;
    const { error } = await supabase.from('payment_methods').update({ transaction_code_id: b.code }).eq('id', b.method);
    if (error) throw error;
  }

  // Branch defaults: tip + Royal Card (revenue codes are per service category;
  // the manual-revenue default is configured via Settings → Branches).
  const { data: branches } = await supabase.from('branches').select('id');
  for (const b of branches ?? []) {
    const { error } = await supabase
      .from('branches')
      .update({ default_tip_transaction_code_id: tcId['TIP-PAYMAYA'] ?? null, royal_card_transaction_code_id: tcId['REDEEM-ROYAL-CARD'] ?? null })
      .eq('id', b.id);
    if (error) throw error;
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
