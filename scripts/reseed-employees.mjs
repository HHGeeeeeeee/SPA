#!/usr/bin/env node
// One-off: clear the employees table and re-seed from the official EP roster.
// All existing rows are pre-prod test data with zero transactional references
// (verified: order_items / tips / commission_entries / shifts / etc. all 0),
// so a hard DELETE is safe. Usage: node scripts/reseed-employees.mjs
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
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// Position label (as in the CSV) -> positions.code in the master table.
// "Cashier" has no master row -> position_id left null (per user decision).
const POSITION_CODE = {
  'Massage Therapist': 'MASSAGE_THERAPIST',
  Nails: 'NAIL_TECHNICIAN',
  Manager: 'STORE_MANAGER',
  Cashier: null,
};

// [EP code, "LAST, FIRST MIDDLE", position label]
const ROSTER = [
  ['EP000686', 'ABAD, JEREMIAS S.', 'Massage Therapist'],
  ['EP000681', 'ACASO, JULYBETH D.', 'Massage Therapist'],
  ['EP000725', 'ANALA, NANETTE', 'Massage Therapist'],
  ['EP000723', 'ARAGON, ANALYN', 'Massage Therapist'],
  ['EP000687', 'ARTUGUE, NELJOY S.', 'Nails'],
  ['EP000696', 'ARZAGA, GLENDYL L.', 'Massage Therapist'],
  ['EP000678', 'AZUCENA, AURORA D.', 'Massage Therapist'],
  ['EP000722', 'BASAÑEZ, EULISA BEATRIZ', 'Nails'],
  ['EP000698', 'CAÑELAS, RHEA P.', 'Massage Therapist'],
  ['EP000695', 'CARIASO, AIZA T.', 'Massage Therapist'],
  ['EP000707', 'CARIASO, REALYN G.', 'Massage Therapist'],
  ['EP000724', 'DECENA, DAREEN', 'Massage Therapist'],
  ['EP000699', 'DELA CRUZ, LONY JEAN L.', 'Massage Therapist'],
  ['EP000691', 'DOLLIENTE, MARLENE S.', 'Massage Therapist'],
  ['EP000690', 'ESLANAN, JOBERT E.', 'Massage Therapist'],
  ['EP000679', 'FLORES, DONNA ROSE G.', 'Massage Therapist'],
  ['EP000682', 'FLORES, LEAH MAE R.', 'Cashier'],
  ['EP000697', 'GOMEZ, DELAPAZ Q.', 'Massage Therapist'],
  ['EP000700', 'JIMENEZ, RENEBIE P.', 'Massage Therapist'],
  ['EP000711', 'MALTO, JESSA MAY', 'Massage Therapist'],
  ['EP000703', 'MARTINEZ, JERIC', 'Massage Therapist'],
  ['EP000685', 'MOLITO, JELLY R.', 'Massage Therapist'],
  ['EP000693', 'NALICA, CHERIFER V.', 'Cashier'],
  ['EP000704', 'NAMIA, DANIELA D.', 'Massage Therapist'],
  ['EP000694', 'ORMIDO, ROSE ANN J.', 'Massage Therapist'],
  ['EP000709', 'OSUNA, MARISSE', 'Nails'],
  ['EP000688', 'PAMPANGA, JONNA G.', 'Massage Therapist'],
  ['EP000714', 'PIA, NADIA', 'Massage Therapist'],
  ['EP000683', 'PROVIDENCIA, SHEILLA A.', 'Massage Therapist'],
  ['EP000680', 'RAMILO, CAREN P.', 'Massage Therapist'],
  ['EP000689', 'REBOTABO, KHAYE SOUVENIR E.', 'Massage Therapist'],
  ['EP000676', 'RICO, ALYZA A.', 'Massage Therapist'],
  ['EP000715', 'RUFOLE, LOVELY JOY', 'Manager'],
  ['EP000706', 'RUIZ, MARY ANN C.', 'Massage Therapist'],
  ['EP000684', 'SAMANIEGO, CRISTINE U.', 'Massage Therapist'],
  ['EP000701', 'SANOY, MARK FRANCIS O.', 'Massage Therapist'],
  ['EP000677', 'SATOC, GRETCHEN G.', 'Massage Therapist'],
  ['EP000702', 'SERNAL, MARILYN M.', 'Nails'],
  ['EP000705', 'TAIB, SAIRA C.', 'Massage Therapist'],
  ['EP000721', 'WARDE, JOSIE', 'Massage Therapist'],
  ['EP000713', 'ZAMORA, ELSA', 'Massage Therapist'],
];

// Title-case a token, preserving the initial-dot form ("S." -> "S.").
const titleWord = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
const titleCase = (str) => str.split(/\s+/).map(titleWord).join(' ');
// "LAST, FIRST MIDDLE" -> "First Middle Last"
const toFirstLast = (raw) => {
  const [last, first] = raw.split(',').map((p) => p.trim());
  return `${titleCase(first)} ${titleCase(last)}`;
};

async function main() {
  console.log('Re-seeding employees from EP roster…');

  const { data: positions, error: pe } = await s.from('positions').select('id, code');
  if (pe) throw pe;
  const posId = Object.fromEntries(positions.map((p) => [p.code, p.id]));

  const { data: bu, error: be } = await s.from('business_units').select('id, code').eq('code', 'spa').single();
  if (be) throw be;
  const SPA_UNIT = bu.id;

  // Wipe existing employees (hard delete — no FK references exist).
  const { data: existing, error: le } = await s.from('employees').select('id');
  if (le) throw le;
  console.log(`  · deleting ${existing.length} existing employees`);
  const { error: de } = await s.from('employees').delete().not('id', 'is', null);
  if (de) throw de;

  const rows = ROSTER.map(([code, rawName, posLabel]) => {
    const posCode = POSITION_CODE[posLabel];
    return {
      employee_code: code,
      name: toFirstLast(rawName),
      position_id: posCode ? posId[posCode] : null,
      business_unit_id: SPA_UNIT,
      status: 'active',
    };
  });

  console.log(`  · inserting ${rows.length} employees`);
  const { error: ie } = await s.from('employees').insert(rows);
  if (ie) throw ie;

  console.log('Done. Inserted:');
  for (const r of rows) console.log(`    ${r.employee_code}  ${r.name}  [${r.position_id ? 'pos' : 'no-pos'}]`);
}

main().catch((err) => {
  console.error('Reseed failed:', err);
  process.exit(1);
});
