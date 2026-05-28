#!/usr/bin/env node
// One-off: ensure ENGO's billing destination is THIRD-PARTY (cash settle), not
// intercompany. The original seed inherited the bd() intercompany default by
// mistake. Safe + idempotent — only touches the ENGO row's settlement fields.
// Usage: node scripts/fix-engo-billing.mjs

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

const { data: before, error: e1 } = await supabase
  .from('billing_destinations')
  .select('code, settlement_type, intercompany_account, intercompany_sub, credit_terms_days')
  .eq('code', 'ENGO')
  .maybeSingle();
if (e1) { console.error(e1); process.exit(1); }
console.log('ENGO before:', before);

if (!before) { console.log('No ENGO billing destination found.'); process.exit(0); }
if (before.settlement_type === 'third_party' && !before.intercompany_account) {
  console.log('Already correct (third_party, no intercompany account). Nothing to do.');
  process.exit(0);
}

const { error: e2 } = await supabase
  .from('billing_destinations')
  .update({ settlement_type: 'third_party', intercompany_account: null, intercompany_sub: null, credit_terms_days: 30 })
  .eq('code', 'ENGO');
if (e2) { console.error(e2); process.exit(1); }

const { data: after } = await supabase
  .from('billing_destinations')
  .select('code, settlement_type, intercompany_account, intercompany_sub, credit_terms_days')
  .eq('code', 'ENGO')
  .maybeSingle();
console.log('ENGO after: ', after);
console.log('Fixed.');
