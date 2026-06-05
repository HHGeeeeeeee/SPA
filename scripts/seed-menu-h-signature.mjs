#!/usr/bin/env node
/*
 * Seed the catalog from the official printed "H Signature Spa — Complete Spa & Wellness" menu.
 * This is the authoritative price list. Wipes any existing items/prices first, then inserts.
 * Categories are reused (created earlier): MASSAGE, BODYSPA, FACIAL, EYELASH, NAIL.
 * Durations marked (assumed) come from menu rows labelled SERVICE / PACKAGE / 2 HRS.
 * Usage: node scripts/seed-menu-h-signature.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const EFFECTIVE_FROM = '2026-06-01';
const EFFECTIVE_TO = '2999-12-31';
const RES = { MASSAGE: ['massage_bed'], BODYSPA: ['massage_bed'], FACIAL: ['facial_bed'], EYELASH: ['facial_bed'], NAIL: ['nail_station', 'chair'] };
// Per-item overrides (service can run on more than its category default).
const RES_OVERRIDE = { FOOT60: ['massage_bed', 'chair'], FOOTHAND60: ['massage_bed', 'chair'], FOOTSPADLX: ['massage_bed', 'chair'] };

// [cat, group, code, name, duration_minutes, price_pesos]
const MENU = [
  // ---- MASSAGE ----
  ['MASSAGE', 'Signature Full Body Massage', 'SIG60', 'Signature Full Body Massage 60min', 60, 1600],
  ['MASSAGE', 'Signature Full Body Massage', 'SIG90', 'Signature Full Body Massage 90min', 90, 2200],
  ['MASSAGE', 'Sun & Sea Recovery', 'SUNSEA60', 'Sun & Sea Recovery 60min', 60, 1600],
  ['MASSAGE', 'Sun & Sea Recovery', 'SUNSEA90', 'Sun & Sea Recovery 90min', 90, 2200],
  ['MASSAGE', 'Filipino Ayurvedic Massage', 'FILAYU60', 'Filipino Ayurvedic Massage 60min', 60, 1600],
  ['MASSAGE', 'Filipino Ayurvedic Massage', 'FILAYU90', 'Filipino Ayurvedic Massage 90min', 90, 2200],
  ['MASSAGE', 'H Signature Head Spa Ritual', 'HEADSPA90', 'H Signature Head Spa Ritual 90min', 90, 3500],
  ['MASSAGE', 'Ayurvedic Hot Stone Massage', 'HOTSTONE90', 'Ayurvedic Hot Stone Massage 90min', 90, 2400],
  ['MASSAGE', 'Swedish Relaxation Massage', 'SWED60', 'Swedish Relaxation Massage 60min', 60, 1500],
  ['MASSAGE', 'Swedish Relaxation Massage', 'SWED90', 'Swedish Relaxation Massage 90min', 90, 2200],
  ['MASSAGE', 'Shiatsu (Dry Massage)', 'SHIATSU60', 'Shiatsu (Dry Massage) 60min', 60, 1600],
  ['MASSAGE', 'Shiatsu (Dry Massage)', 'SHIATSU90', 'Shiatsu (Dry Massage) 90min', 90, 2200],
  ['MASSAGE', 'Couple Massage', 'COUPLE60', 'Couple Massage 60min', 60, 3500],
  ['MASSAGE', 'Head, Back and Shoulder Massage', 'HBS60', 'Head, Back and Shoulder Massage 60min', 60, 1600],
  ['MASSAGE', 'Facial Cleansing Gua Sha Massage', 'GUASHA60', 'Facial Cleansing Gua Sha Massage Treatment 60min', 60, 1500],
  ['MASSAGE', 'Facial Cleansing Gua Sha Massage', 'GUASHA90', 'Facial Cleansing Gua Sha Massage Treatment 90min', 90, 2000],
  ['MASSAGE', 'Foot and Hand Massage', 'FOOTHAND60', 'Foot and Hand Massage 60min', 60, 1600],
  ['MASSAGE', 'Foot Massage', 'FOOT60', 'Foot Massage 60min', 60, 1500],
  // ---- BODY SPA ----
  ['BODYSPA', 'Full Body Scrub', 'SCRUB60', 'Full Body Scrub 60min', 60, 2000],
  ['BODYSPA', 'Foot Spa Deluxe', 'FOOTSPADLX', 'Foot Spa Deluxe (Package)', 60, 2000],
  // ---- FACIAL ----
  ['FACIAL', 'Basic Facial Cleansing & Scrubbing', 'FACIAL60', 'Basic Facial Cleansing & Scrubbing with Facial Massage 60min', 60, 1500],
  ['FACIAL', 'Facial Cleansing with Fresh Fruit Mask', 'FACIALFRUIT90', 'Facial Cleansing & Scrubbing with Natural Fresh Fruit Mask & Facial Massage 90min', 90, 2000],
  // ---- EYELASH & EYEBROW ----
  ['EYELASH', 'Eyelash Extension (Classic)', 'LASHEXT90', 'Eyelash Extension (Classic) 90min', 90, 1700],
  ['EYELASH', 'Eyelash Lift (with Tint)', 'LASHLIFT60', 'Eyelash Lift (with Tint) 60min', 60, 2700],
  ['EYELASH', 'Eyelash Removal', 'LASHREM', 'Eyelash Removal', 30, 700],
  ['EYELASH', 'Eyebrow Threading', 'BROWTHREAD', 'Eyebrow Threading', 15, 500],
  // ---- NAIL SPA ----
  ['NAIL', 'Nail Gel Polish - Hands', 'GELHANDS60', 'Nail Gel Polish - Hands 60min', 60, 1000],
  ['NAIL', 'Nail Gel Polish - Feet', 'GELFEET60', 'Nail Gel Polish - Feet 60min', 60, 1000],
  ['NAIL', 'Regular Polish - Feet', 'REGFEET60', 'Regular Polish - Feet 60min', 60, 700],
  ['NAIL', 'Nail Fix (per Nail)', 'NAILFIX', 'Nail Fix (per Nail) 15min', 15, 350],
  ['NAIL', 'Soft Gel Nail Extension', 'SOFTGEL', 'Soft Gel Nail Extension', 120, 1800],
  ['NAIL', 'Builder Gel / BIAB', 'BIAB', 'Builder Gel / BIAB', 120, 2600],
  // ---- NAIL ADD-ONS ----
  ['NAIL', 'Add-ons', 'ADD_CLEAN', 'Nail Cleaning (Add-on)', 15, 500],
  ['NAIL', 'Add-ons', 'ADD_REGPOL', 'Regular Polish (Add-on)', 20, 400],
  ['NAIL', 'Add-ons', 'ADD_HGREM', 'Hard Gel Removal (Add-on)', 20, 600],
  ['NAIL', 'Add-ons', 'ADD_FCO', 'French Tip, Chrome, Ombre - Full Set (Add-on)', 30, 300],
  ['NAIL', 'Add-ons', 'ADD_NAILART', 'Nail Art per Nail (Add-on)', 10, 100],
];

async function main() {
  const { data: cats, error: ce } = await s.from('service_categories').select('id, code');
  if (ce) throw ce;
  const catId = Object.fromEntries(cats.map((c) => [c.code, c.id]));
  const { data: bu, error: be } = await s.from('business_units').select('id, code').eq('code', 'spa').single();
  if (be) throw be;
  const SPA = bu.id;

  // wipe existing catalog (+ any test order references)
  for (const t of ['order_items', 'service_item_prices', 'service_items']) {
    const del = await s.from(t).delete().not('id', 'is', null);
    if (del.error) throw new Error(`wipe ${t}: ${del.error.message}`);
  }
  console.log('Wiped existing catalog.');

  const itemRows = MENU.map(([cat, group, code, name, duration]) => ({
    code, name,
    service_category_id: catId[cat],
    duration_minutes: duration,
    prep_before_minutes: 0,
    cleanup_after_minutes: 0,
    allowed_resource_types: RES_OVERRIDE[code] ?? RES[cat] ?? [],
    pricing_model: 'per_session',
    commission_applicable: true,
    tip_applicable: true,
    business_unit_id: SPA,
    service_group: group,
    active: true,
  }));
  const ins = await s.from('service_items').insert(itemRows).select('id, code');
  if (ins.error) throw ins.error;
  const idByCode = Object.fromEntries(ins.data.map((r) => [r.code, r.id]));
  console.log(`Inserted ${ins.data.length} service_items.`);

  const priceRows = MENU.map(([, , code, , , price]) => ({
    service_item_id: idByCode[code],
    price_class: 'Normal',
    branch_id: null,
    effective_from: EFFECTIVE_FROM,
    effective_to: EFFECTIVE_TO,
    price_cents: price * 100,
    currency: 'PHP',
  }));
  const insP = await s.from('service_item_prices').insert(priceRows);
  if (insP.error) throw insP.error;
  console.log(`Inserted ${priceRows.length} prices.`);

  // summary
  const byCat = {};
  for (const [cat] of MENU) byCat[cat] = (byCat[cat] || 0) + 1;
  console.log('\nBy category:');
  for (const k of Object.keys(byCat)) console.log(`  ${k.padEnd(8)} ${byCat[k]}`);
  console.log('\nDONE.');
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });