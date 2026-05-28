// Business-day-close enforcement.
//
// Daily-close discipline: if a branch forgot to close yesterday's day, every
// GL-writing / settle action is blocked once we're 2+ days overdue. Manager
// can force-close with a written reason to unblock (audit-logged).
//
// Guard contract:
//   getOldestOverdueClose(branchId, today) → null if all closed, or the
//     oldest unclosed business_date + how many full days overdue.
//   assertNoBlockedClose(branchId) → throws "Business day(s) ... not closed"
//     if any branch day is 2+ days overdue. Use this at the top of any GL /
//     settle server action.
//
// Threshold: warning at 1 day overdue (UI banner only), block at 2+. The
// extra grace day exists so an early-morning close-yesterday is normal and
// doesn't cripple the desk.

import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export interface OverdueClose {
  branch_id: string;
  business_date: string; // yyyy-mm-dd PHT
  days_overdue: number;  // 1 = yesterday not closed, 2 = day before, ...
}

/** PHT (Asia/Manila) today as yyyy-mm-dd. Single source of truth for "today". */
export function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Number of full days between two yyyy-mm-dd strings (b - a, UTC math). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

/**
 * Oldest business_date at this branch with status != 'closed' AND strictly
 * before today (PHT). Returns null if none. days_overdue counts the gap from
 * that date to today: 1 = yesterday, 2 = day before, etc.
 *
 * A force-closed row IS considered closed (closed_at is set by the override).
 */
export async function getOldestOverdueClose(branchId: string): Promise<OverdueClose | null> {
  const supabase = createServiceClient();
  const today = todayPHT();
  const { data } = await supabase
    .from('business_day_close')
    .select('business_date, status, closed_at')
    .eq('branch_id', branchId)
    .neq('status', 'closed')
    .lt('business_date', today)
    .order('business_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    branch_id: branchId,
    business_date: data.business_date,
    days_overdue: daysBetween(data.business_date, today),
  };
}

/**
 * Block if the branch is 2+ days overdue on EoD close.
 * Throws an Error whose message is shown to the user. Catch at the action
 * boundary and return { ok: false, error: e.message } so the UI gets the
 * specific date to point the manager at.
 */
export async function assertNoBlockedClose(branchId: string): Promise<void> {
  const overdue = await getOldestOverdueClose(branchId);
  if (!overdue) return;
  if (overdue.days_overdue < 2) return; // 1-day grace
  throw new Error(
    `Blocked: business day ${overdue.business_date} hasn't been closed ` +
    `(${overdue.days_overdue} days overdue). Close it on the End-of-Day page first, ` +
    `or ask a manager to force-close with a reason.`,
  );
}

/** Same as `assertNoBlockedClose` but returns the overdue close instead of throwing,
 *  for cases where you want to render a warning vs. an outright error. */
export async function checkOverdueClose(branchId: string): Promise<{
  overdue: OverdueClose | null;
  /** true = block (2+ days), false = warn only (1 day), null = none */
  blocked: boolean | null;
}> {
  const overdue = await getOldestOverdueClose(branchId);
  if (!overdue) return { overdue: null, blocked: null };
  return { overdue, blocked: overdue.days_overdue >= 2 };
}
