#!/usr/bin/env node
// Seed HSPA2 employee_shifts for 2026-06-01 .. 2026-06-14 from the physical board.
// Working days -> 'regular' with the section shift times; D-Off -> 'off';
// Elsa Zamora wk2 -> sick leave; Donna Flores 06-03 -> leave.
// Wipes the existing placeholder rows for this branch+range first.
// Usage: node scripts/seed-shifts-jun01-14.mjs
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

const BRANCH_HSPA2 = '7ed648b1-dc4d-469d-a3e4-c072bf6dd458';
const d = (n) => `2026-06-${String(n).padStart(2, '0')}`;
const ALL_DATES = Array.from({ length: 14 }, (_, i) => d(i + 1));

// shift section times
const AM = ['09:00', '18:00'];
const MID = ['12:00', '21:00'];
const PM = ['15:00', '00:00']; // 3pm - midnight
const OSUNA = ['10:00', '19:00'];
const ANALA = ['12:00', '21:00'];

// [employee_code, [start,end], offDays[], leaveDays{date:type}]
const BOARD = [
  // AM SHIFT
  ['EP000696', AM, [d(3), d(11)]],                 // Glendyl Arzaga
  ['EP000707', AM, [d(6), d(14)]],                 // Realyn Cariaso
  ['EP000695', AM, [d(1), d(8)]],                  // Aiza Cariaso
  ['EP000697', AM, [d(4), d(12)]],                 // Delapaz Gomez
  ['EP000700', AM, [d(5), d(8)]],                  // Renebie Jimenez
  ['EP000686', AM, [d(5), d(11)]],                 // Jeremias Abad
  ['EP000713', AM, [d(7)], { [d(10)]: 'sick', [d(11)]: 'sick', [d(12)]: 'sick', [d(13)]: 'sick', [d(14)]: 'sick' }], // Elsa Zamora
  // NAIL
  ['EP000709', OSUNA, [d(6), d(14)]],              // Marisse Osuna
  ['EP000725', ANALA, [d(1), d(9)]],               // Nanette Anala
  // MID SHIFT
  ['EP000681', MID, [d(6), d(8)]],                 // Julybeth Acaso
  ['EP000679', MID, [d(2), d(11)], { [d(3)]: 'vacation' }], // Donna Flores (06-03 LEAVE)
  ['EP000694', MID, [d(1), d(10)]],                // Rose Ann Ormido
  ['EP000676', MID, [d(1), d(10)]],                // Alyza Rico
  ['EP000704', MID, [d(3), d(9)]],                 // Daniela Namia
  ['EP000689', MID, [d(4), d(13)]],                // Khaye Rebotabo
  ['EP000705', MID, [d(3), d(10)]],                // Saira Taib
  // PM SHIFT
  ['EP000723', PM, [d(3), d(8)]],                  // Analyn Aragon
  ['EP000678', PM, [d(5), d(11)]],                 // Aurora Azucena
  ['EP000722', PM, [d(2), d(11)]],                 // Eulisa Basañez
  ['EP000724', PM, [d(3), d(10)]],                 // Dareen Decena
  ['EP000699', PM, [d(4), d(12)]],                 // Lony Jean Dela Cruz
  ['EP000691', PM, [d(5), d(13)]],                 // Marlene Dolliente
  ['EP000690', PM, [d(1), d(9)]],                  // Jobert Eslanan
  ['EP000685', PM, [d(6), d(14)]],                 // Jelly Molito
  ['EP000688', PM, [d(2), d(10)]],                 // Jonna Pampanga
  ['EP000683', PM, [d(4), d(12)]],                 // Sheilla Providencia
  ['EP000680', PM, [d(1), d(13)]],                 // Caren Ramilo
  ['EP000706', PM, [d(5), d(12)]],                 // Mary Ann Ruiz
  ['EP000684', PM, [d(6), d(12)]],                 // Cristine Samaniego
  ['EP000677', PM, [d(3), d(14)]],                 // Gretchen Satoc
  ['EP000702', PM, [d(3), d(11)]],                 // Marilyn Sernal
  ['EP000721', PM, [d(1), d(10)]],                 // Josie Warde
];

async function main() {
  // resolve employee ids
  const codes = BOARD.map((b) => b[0]);
  const { data: emps, error: ee } = await s.from('employees').select('id, employee_code, name').in('employee_code', codes);
  if (ee) throw ee;
  const idByCode = Object.fromEntries(emps.map((e) => [e.employee_code, e.id]));
  const missing = codes.filter((c) => !idByCode[c]);
  if (missing.length) throw new Error('Missing employee codes: ' + missing.join(', '));
  console.log(`Resolved ${emps.length}/${codes.length} employees`);

  // wipe existing rows for this branch + range
  const del = await s.from('employee_shifts').delete()
    .eq('branch_id', BRANCH_HSPA2).gte('shift_date', d(1)).lte('shift_date', d(14));
  if (del.error) throw del.error;
  console.log('Deleted existing HSPA2 shifts in 06-01..06-14');

  // build rows
  const rows = [];
  let reg = 0, off = 0, lv = 0;
  for (const [code, [start, end], offs = [], leaves = {}] of BOARD) {
    for (const date of ALL_DATES) {
      const base = { employee_id: idByCode[code], branch_id: BRANCH_HSPA2, shift_date: date, generated_from_template: false };
      if (leaves[date]) {
        rows.push({ ...base, shift_type: 'leave', leave_type: leaves[date], shift_start: null, shift_end: null });
        lv++;
      } else if (offs.includes(date)) {
        rows.push({ ...base, shift_type: 'off', shift_start: null, shift_end: null });
        off++;
      } else {
        rows.push({ ...base, shift_type: 'regular', shift_start: start, shift_end: end });
        reg++;
      }
    }
  }

  const ins = await s.from('employee_shifts').insert(rows);
  if (ins.error) throw ins.error;
  console.log(`Inserted ${rows.length} rows  (regular=${reg}, off=${off}, leave=${lv})  for ${BOARD.length} employees x 14 days`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });