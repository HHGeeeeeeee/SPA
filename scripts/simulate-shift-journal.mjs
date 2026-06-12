#!/usr/bin/env node
// Simulate the GL journal a shift would post to Acumatica — same 1:1 logic as
// src/lib/shift-erp-posting.ts buildShiftGlLines (every folio line = its own
// DR/CR pair, no netting), printed as a voucher.
// Usage: node scripts/simulate-shift-journal.mjs [shift_id]   (default: latest closed shift)

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
const one = (v) => (Array.isArray(v) ? (v[0] ?? null) : v);
const SUB_FALLBACK = '000000000';

let shiftId = process.argv[2];
if (!shiftId) {
  const { data } = await supabase
    .from('shifts').select('id').eq('status', 'closed')
    .order('opened_at', { ascending: false }).limit(1).maybeSingle();
  shiftId = data?.id;
}
const { data: shift } = await supabase
  .from('shifts')
  .select('id, business_date, label, branch:branches!shifts_branch_id_fkey ( code )')
  .eq('id', shiftId).maybeSingle();
if (!shift) { console.error('shift not found'); process.exit(1); }
const shiftBranchCode = one(shift.branch)?.code ?? '';

const { data: lines } = await supabase
  .from('folio_lines')
  .select('amount_cents, kind, posted_at, transaction_code_id, dr_branch, cr_branch, code:transaction_codes ( code, debit_account, debit_subaccount, debit_branch_id, credit_account, credit_subaccount, credit_branch_id ), order:orders!folio_lines_order_id_fkey ( order_no ), soa:revenue_soa!folio_lines_soa_session_id_fkey ( soa_no )')
  .eq('shift_id', shiftId)
  .not('transaction_code_id', 'is', null)
  .order('posted_at', { ascending: true });

const signed = (kind, cents) => (kind === 'refund' ? -cents : cents);
const gl = [];
for (const l of lines ?? []) {
  const tx = one(l.code);
  if (!tx || !l.transaction_code_id) continue;
  const v = signed(l.kind, l.amount_cents);
  if (v === 0) continue;
  const drBranch = l.dr_branch?.trim() || tx.debit_branch_id?.trim() || shiftBranchCode;
  const crBranch = l.cr_branch?.trim() || tx.credit_branch_id?.trim() || shiftBranchCode;
  const ref = one(l.order)?.order_no ?? one(l.soa)?.soa_no ?? '';
  const positive = v > 0;
  const value = Math.abs(v) / 100;
  const dr = positive
    ? { account: tx.debit_account, sub: tx.debit_subaccount, branch: drBranch }
    : { account: tx.credit_account, sub: tx.credit_subaccount, branch: crBranch };
  const cr = positive
    ? { account: tx.credit_account, sub: tx.credit_subaccount, branch: crBranch }
    : { account: tx.debit_account, sub: tx.debit_subaccount, branch: drBranch };
  if (!dr.account || !cr.account) { console.log(`(skipped ${tx.code} · ${ref} — code missing DR/CR account)`); continue; }
  const reversal = positive ? '' : l.kind === 'refund' ? ' (refund)' : ' (reversal)';
  const desc = `${tx.code}${ref ? ` · ${ref}` : ''}${reversal}`;
  gl.push({ side: 'DR', branch: dr.branch, account: dr.account, sub: dr.sub ?? SUB_FALLBACK, ref, desc, amount: value });
  gl.push({ side: 'CR', branch: cr.branch, account: cr.account, sub: cr.sub ?? SUB_FALLBACK, ref, desc, amount: value });
}

console.log(`Journal Transaction (simulated — NOT posted)`);
console.log(`  Date:        ${shift.business_date}`);
console.log(`  Branch:      ${shiftBranchCode}`);
console.log(`  Description: Sales remittance · ${shift.label}`);
console.log('');
console.log('  ' + ['', 'Branch', 'Account', 'Sub', 'Ref Number', 'Description'.padEnd(44), '      Debit', '     Credit'].join(' | '));
let drT = 0, crT = 0;
for (const g of gl) {
  const drAmt = g.side === 'DR' ? g.amount : null;
  const crAmt = g.side === 'CR' ? g.amount : null;
  drT += drAmt ?? 0; crT += crAmt ?? 0;
  console.log('  ' + [
    g.side,
    g.branch.padEnd(6),
    g.account.padEnd(7),
    g.sub.padEnd(9),
    g.ref.padEnd(10),
    g.desc.padEnd(44),
    (drAmt != null ? drAmt.toLocaleString('en-PH', { minimumFractionDigits: 2 }) : '').padStart(11),
    (crAmt != null ? crAmt.toLocaleString('en-PH', { minimumFractionDigits: 2 }) : '').padStart(11),
  ].join(' | '));
}
console.log('  ' + '-'.repeat(128));
console.log('  ' + ['  ', '      ', '       ', '         ', '          ', 'TOTAL'.padEnd(44), drT.toLocaleString('en-PH', { minimumFractionDigits: 2 }).padStart(11), crT.toLocaleString('en-PH', { minimumFractionDigits: 2 }).padStart(11)].join(' | '));
console.log(`  Balanced: ${Math.abs(drT - crT) < 0.005 ? 'YES' : 'NO — OFF BY ' + (drT - crT).toFixed(2)}`);
process.exit(0);
