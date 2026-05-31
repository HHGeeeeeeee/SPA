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

  // ---- Transaction codes (sample — Excel-derived, HSPA2)
  console.log('  · transaction_codes');
  const { data: branches } = await supabase.from('branches').select('id, code');
  const brId = Object.fromEntries((branches ?? []).map((b) => [b.code, b.id]));

  if (!brId.HSPA2) {
    console.log('    (HSPA2 branch missing — skipping tx codes)');
  } else {
    const txCodes = [
      {
        code: 'HSPA2-PAYMENT-CASH',
        branch_id: brId.HSPA2,
        transaction_type: 'payment',
        payment_method_id: pmId.cash,
        debit_account: '10108',
        debit_subaccount: '000000000',
        credit_account: '40140',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-PAYMENT-PAYMAYA',
        branch_id: brId.HSPA2,
        transaction_type: 'payment',
        payment_method_id: pmId.paymaya,
        debit_account: '10121',
        debit_subaccount: '000000000',
        credit_account: '40140',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-PAYMENT-AR',
        branch_id: brId.HSPA2,
        transaction_type: 'payment',
        payment_method_id: pmId.ar,
        debit_account: '10200',
        debit_subaccount: '000000000',
        credit_account: '40140',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-PAYMENT-TIP-PAYMAYA',
        branch_id: brId.HSPA2,
        transaction_type: 'payment',
        payment_method_id: pmId.paymaya,
        debit_account: '10121',
        debit_subaccount: '000000000',
        credit_account: '20500',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-SETTLE-AR-INTERCOMPANY',
        branch_id: brId.HSPA2,
        transaction_type: 'settle',
        payment_method_id: null,
        debit_account: '50170',
        debit_subaccount: '000000T03',
        credit_account: '10200',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-SETTLE-AR-THIRDPARTY',
        branch_id: brId.HSPA2,
        transaction_type: 'settle',
        payment_method_id: null,
        debit_account: '10111',
        debit_subaccount: '000000000',
        credit_account: '10200',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-SETTLE-TIP-TO-AP',
        branch_id: brId.HSPA2,
        transaction_type: 'settle',
        payment_method_id: null,
        debit_account: '20500',
        debit_subaccount: '000000000',
        credit_account: '20100',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-PAYMENT-SVC-DEPOSIT',
        branch_id: brId.HSPA2,
        transaction_type: 'payment',
        payment_method_id: pmId.stored_value_card,
        debit_account: '10108',
        debit_subaccount: '000000000',
        credit_account: '20510',
        credit_subaccount: '000000000',
      },
      {
        code: 'HSPA2-SETTLE-SVC',
        branch_id: brId.HSPA2,
        transaction_type: 'settle',
        payment_method_id: pmId.stored_value_card,
        debit_account: '20510',
        debit_subaccount: '000000000',
        credit_account: '40140',
        credit_subaccount: '000000000',
      },
    ];
    for (const tc of txCodes) {
      const { error } = await supabase.from('transaction_codes').upsert(
        { ...tc, active: true },
        { onConflict: 'code,branch_id' },
      );
      // The partial unique index transaction_codes_logical_key (20260530150000)
      // locks one active row per (branch, type, method, credit_account). Two of
      // these SAMPLE settle rows (AR-INTERCOMPANY vs AR-THIRDPARTY) share that
      // logical key — they differ only by debit_account — so the second one
      // collides. Skip-with-warning instead of aborting the batch: the real GL
      // mappings get configured per-branch via the Master Data UI once ERP is
      // wired up; this loader only lays down illustrative defaults.
      if (error) {
        if (error.code === '23505') {
          console.log(`    ⚠ skipped ${tc.code} — logical-key clash with an existing active row (configure via UI)`);
          continue;
        }
        throw error;
      }
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
