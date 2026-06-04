import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

/**
 * Company-wide daily Sales Order number: SO-YYMMDD-NNNN (e.g. SO-260604-0001).
 *
 * One running sequence per service date across ALL branches — the branch is NOT
 * baked into the number (it lives in its own column); HSPA1/HSPA2 interleave on
 * one daily counter. Zero-padded to 4 digits so a lexical "max" lookup equals
 * the numeric max. `serviceDate` is a YYYY-MM-DD string.
 *
 * Single source of truth for the SO number format — used by manual order
 * creation, reservation→order conversion, and waitlist→order conversion so
 * every path produces the same scheme and shares the same daily sequence.
 */
export async function nextOrderNo(
  supabase: SupabaseClient<Database>,
  serviceDate: string,
): Promise<string> {
  const yymmdd = serviceDate.replace(/-/g, '').slice(2); // 2026-06-04 -> 260604
  const prefix = `SO-${yymmdd}-`;
  const { data } = await supabase
    .from('orders')
    .select('order_no')
    .like('order_no', `${prefix}%`)
    .order('order_no', { ascending: false })
    .limit(1);
  const last = data?.[0]?.order_no;
  const lastSeq = last ? Number(last.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}
