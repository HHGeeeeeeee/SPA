#!/usr/bin/env node
// One-off seed script: inserts initial master data using service role.
// Usage: node scripts/seed-initial-data.mjs

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
  console.log('Seeding initial master data…');

  // Branches
  console.log('  · branches');
  const { error: e1 } = await supabase
    .from('branches')
    .upsert(
      [
        { code: 'OSP1', name: 'Oriental SPA 1', active: true },
        { code: 'HSPA2', name: 'Oriental SPA 2', active: true },
        { code: 'SPA3', name: 'SPA 666', active: false },
        { code: 'SPA4', name: 'SPA 888', active: false },
      ],
      { onConflict: 'code' },
    );
  if (e1) throw e1;

  // Commission classes
  console.log('  · commission_classes');
  const { error: e2 } = await supabase
    .from('commission_classes')
    .upsert(
      [
        { class_code: 'M', name: 'Master', commission_rate: 0.5, active: true },
        { class_code: 'S', name: 'Senior', commission_rate: 0.4, active: true },
        { class_code: 'J', name: 'Junior', commission_rate: 0.3, active: true },
      ],
      { onConflict: 'class_code' },
    );
  if (e2) throw e2;

  // Discount classes (per design DIS-00 ~ DIS-99)
  console.log('  · discount_classes');
  const dc = (overrides) => ({
    discount_percent: 0,
    discount_amount_cents: 0,
    requires_approval: false,
    force_apply: false,
    active: true,
    ...overrides,
  });
  const { error: e3 } = await supabase
    .from('discount_classes')
    .upsert(
      [
        dc({ code: 'DIS-00', description: 'No Discount' }),
        dc({ code: 'DIS-01', description: 'Local', discount_percent: 10 }),
        dc({ code: 'DIS-02', description: 'Low Season', discount_percent: 10 }),
        dc({ code: 'DIS-03', description: 'Senior Citizen', discount_percent: 10 }),
        dc({ code: 'DIS-04', description: 'PWD', discount_percent: 10 }),
        dc({ code: 'DIS-05', description: 'Employee', discount_percent: 10 }),
        dc({ code: 'DIS-06', description: 'Coupon -200', discount_amount_cents: 20000 }),
        dc({ code: 'DIS-60', description: 'Group-1', discount_percent: 10 }),
        dc({ code: 'DIS-61', description: 'Group-2', discount_percent: 15 }),
        dc({ code: 'DIS-62', description: 'Group-3', discount_percent: 20 }),
        dc({ code: 'DIS-80', description: 'Stored Value -1', discount_percent: 10 }),
        dc({ code: 'DIS-81', description: 'Stored Value -2', discount_percent: 15 }),
        dc({ code: 'DIS-82', description: 'Stored Value -3', discount_percent: 20 }),
        dc({ code: 'DIS-90', description: 'Full discount — customer complaint (100%)', discount_percent: 100, requires_approval: true }),
        dc({ code: 'DIS-91', description: 'Manager Special Discount', requires_approval: true }),
        dc({ code: 'DIS-99', description: 'Manual Input', requires_approval: true }),
      ],
      { onConflict: 'code' },
    );
  if (e3) throw e3;

  // Payment methods
  console.log('  · payment_methods');
  const pm = (overrides) => ({
    currency: 'PHP',
    method_type: 'one_time',
    manual_reconciliation: true,
    requires_reference: false,
    active: true,
    ...overrides,
  });
  const { error: e4 } = await supabase
    .from('payment_methods')
    .upsert(
      [
        pm({ code: 'cash', display_name: 'Cash' }),
        pm({ code: 'paymaya', display_name: 'PAYMAYA', manual_reconciliation: false, requires_reference: true }),
        pm({ code: 'ar', display_name: 'AR (Account Receivable)' }),
        pm({ code: 'stored_value_card', display_name: 'Stored Value Card', method_type: 'stored_value' }),
        pm({ code: 'bank', display_name: 'Bank Transfer', requires_reference: true }),
      ],
      { onConflict: 'code' },
    );
  if (e4) throw e4;

  // Service categories
  // NOTE: business_unit was migrated from a TEXT column on this table to the
  // service_category_business_units junction (20260519164258). We upsert the
  // categories first, then link each to the 'spa' business unit below.
  console.log('  · service_categories');
  const sc = (overrides) => ({
    commission_applicable: true,
    tip_applicable: true,
    active: true,
    ...overrides,
  });
  const { error: e5 } = await supabase
    .from('service_categories')
    .upsert(
      [
        sc({ code: 'MASSAGE', name: 'Massage' }),
        sc({ code: 'HAIR', name: 'Hair Salon' }),
        sc({ code: 'NAIL', name: 'Nail Salon' }),
        sc({ code: 'REST', name: 'Rest / Lounge', commission_applicable: false, tip_applicable: false }),
      ],
      { onConflict: 'code' },
    );
  if (e5) throw e5;

  // Link every category to the SPA business unit via the junction table.
  console.log('  · service_category_business_units');
  const { data: spaUnit } = await supabase
    .from('business_units')
    .select('id')
    .eq('code', 'spa')
    .single();
  const { data: cats } = await supabase
    .from('service_categories')
    .select('id')
    .in('code', ['MASSAGE', 'HAIR', 'NAIL', 'REST']);
  if (spaUnit && cats?.length) {
    const { error: e6 } = await supabase
      .from('service_category_business_units')
      .upsert(
        cats.map((c) => ({ service_category_id: c.id, business_unit_id: spaUnit.id })),
        { onConflict: 'service_category_id,business_unit_id', ignoreDuplicates: true },
      );
    if (e6) throw e6;
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
