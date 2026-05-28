import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data } = await sb.from('tip_settlements')
  .select('settlement_no, status, posting_status, gl_batch_nbr, posting_error, subtotal_cents')
  .order('settlement_no', { ascending: false }).limit(10);
for (const s of data ?? []) {
  console.log(`${s.settlement_no.padEnd(28)} | status=${s.status.padEnd(10)} | posting=${(s.posting_status ?? 'null').padEnd(8)} | bill=${s.gl_batch_nbr ?? '—'} | ${(s.subtotal_cents/100).toFixed(2)}`);
  if (s.posting_error) console.log(`    err: ${s.posting_error.slice(0,200)}`);
}
process.exit(0);
