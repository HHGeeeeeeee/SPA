#!/usr/bin/env node
// One-off, idempotent: fix the Daily Ops help ordering and rewrite the Staff
// Cheat Sheet so each of the 5 steps links to its full guide (#help/<slug>).
// Re-runnable. Usage: node scripts/reorder-daily-ops-help.mjs
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

// Cheat sheet first, then the 5 numbered steps in order, then reference topics.
const ORDER = [
  'staff-cheat-sheet',
  'staff-open-shift',
  'staff-create-order',
  'staff-run-service',
  'staff-take-payment',
  'staff-close-shift',
  'order-and-service-status',
  'service-line-times-plan-vs-actual',
  'interrupted-service-billing-81e8',
  'therapist-absence-and-lineup',
  'report-builder',
];

const CHEAT_SHEET = `Keep this open at the desk. The whole day on one page — each step links to its full guide.

## The 5 daily steps

1. **Open your shift** — Sales Remittance → **Open shift** → pick branch & shift. *(No open shift = you cannot take payment.)* → [Full guide](#help/staff-open-shift)
2. **Create an order** — Calendar → **Create Order** → fill guest(s) → **Create order**. → [Full guide](#help/staff-create-order)
3. **Run the service** — assign **therapist + bed** → **Start** → **Finish & book ₱___**. *(Revenue posts at Finish.)* → [Full guide](#help/staff-run-service)
4. **Take payment** — the order's **Folio** tab → **Add payment** → **Record**. Order closes to **Paid**. → [Full guide](#help/staff-take-payment)
5. **Close your shift** — Sales Remittance → count cash → **Count & close ___**. → [Full guide](#help/staff-close-shift)

## Order states

**Draft → In service → Completed → Paid**

## Key buttons

| You want to… | Button |
| --- | --- |
| Begin a service | **Start** |
| End a service (books revenue) | **Finish** → **Finish & book ₱___** |
| Stop a service part-way | **Interrupt** |
| Guest didn't arrive | **No-show** |
| Mark the whole order done | **Complete** |
| Collect money | **Add payment** → **Record** |
| Reverse a payment | **Add refund** |
| Close the till | **Count & close ___** |

## Remember

- No open shift = you cannot take payment. Open one first.
- **Finish** is the revenue moment — never leave a service running.
- You cannot close your shift while an order still owes money.
- Cash is counted; cards/PAYMAYA balance themselves.
`;

async function main() {
  // 1) Set order_index by slug (only touches rows that exist).
  for (let i = 0; i < ORDER.length; i++) {
    const slug = ORDER[i];
    const { data, error } = await supabase
      .from('help_articles')
      .update({ order_index: i })
      .eq('slug', slug)
      .select('slug');
    if (error) throw error;
    if (!data || data.length === 0) console.warn(`  ! no row for slug "${slug}" (skipped)`);
    else console.log(`  [${String(i).padStart(2)}] ${slug}`);
  }

  // 2) Rewrite the Staff Cheat Sheet body (方案 A: links to each step's guide).
  const { error: csErr } = await supabase
    .from('help_articles')
    .update({ content_markdown: CHEAT_SHEET })
    .eq('slug', 'staff-cheat-sheet');
  if (csErr) throw csErr;
  console.log('  cheat sheet content updated');

  console.log('Done.');
}

main().catch((e) => {
  console.error('Failed:', e.message ?? e);
  process.exit(1);
});
