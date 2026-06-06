import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { isDayCashClosed } from '@/app/(dashboard)/reconciliation/cash/actions';
import { loadArBalance } from '@/app/(dashboard)/reconciliation/soa/actions';
import { getOldestOverdueClose, type OverdueClose } from '@/lib/business-day';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Per-branch summary of the 4-step End-of-Day pipeline status for today.
 *  no_activity → 0 orders today, no work owed.
 *  open        → row not started, or started but no milestones hit yet.
 *  in_progress → at least one of (order_reviewed_at / balances_ok_at /
 *                revenue_confirmed_at) is set but day is not closed.
 *  closed      → status='closed' (4-step pipeline done). */
export type DayStatus = 'closed' | 'in_progress' | 'open' | 'no_activity';

export interface ReconBranchStatus {
  id: string;
  code: string;
  name: string;
  cashClosed: boolean;
  pendingConfirm: number;
  pendingConfirmCents: number;
  /** Any non-void orders today at this branch (any status). false → nothing to
   *  close → UI should show "No activity" grey instead of amber "Pending". */
  hasActivity: boolean;
  /** Today's overall EoD-pipeline state for this branch. */
  dayStatus: DayStatus;
  /** Oldest business-date at this branch with status != closed AND < today (PHT). */
  overdueClose: OverdueClose | null;
}

export interface ReconStatus {
  today: string;
  branches: ReconBranchStatus[];
  cashNotClosed: number;
  pendingConfirm: number;
  pendingConfirmCents: number;
  openTipsCount: number;
  openTipsCents: number;
  unsettledCommissionLines: number;
  arOutstandingCents: number;
  soaUnstated: number;
}

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** One-shot snapshot of what each reconciliation module has outstanding today. */
export async function loadReconStatus(): Promise<ReconStatus> {
  const supabase = createServiceClient();
  const today = todayPHT();

  const [branches, { data: arMethod }] = await Promise.all([
    getAllowedBranches(),
    supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle(),
  ]);
  const branchList = branches;
  const arId = arMethod?.id ?? null;

  // --- Today's orders: include closed too so "activity" reflects the whole
  //     day, not just pending. A branch with all-confirmed orders should
  //     still show "All done" rather than "No activity". ---
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('branch_id, status, total_cents, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
    .eq('service_date', today)
    .is('deleted_at', null)
    .in('status', ['paid', 'completed', 'closed']);
  const pendingByBranch = new Map<string, { n: number; cents: number }>();
  const activityByBranch = new Set<string>();
  for (const o of todayOrders ?? []) {
    activityByBranch.add(o.branch_id);
    if (o.status === 'closed') continue; // already confirmed — counts as activity but not pending
    const isAR = !!arId && one(o.billing)?.default_payment_method_id === arId;
    if (!(o.status === 'paid' || (o.status === 'completed' && isAR))) continue;
    const cur = pendingByBranch.get(o.branch_id) ?? { n: 0, cents: 0 };
    cur.n += 1; cur.cents += o.total_cents;
    pendingByBranch.set(o.branch_id, cur);
  }

  // --- Cash closed + overdue EoD + today's bdc state per branch ---
  const [cashClosedFlags, overdueCloses, { data: bdcToday }] = await Promise.all([
    Promise.all(branchList.map((b) => isDayCashClosed(b.id, today))),
    Promise.all(branchList.map((b) => getOldestOverdueClose(b.id))),
    supabase.from('business_day_close')
      .select('branch_id, status, order_reviewed_at, balances_ok_at, revenue_confirmed_at, closed_at')
      .eq('business_date', today)
      .in('branch_id', branchList.map((b) => b.id)),
  ]);
  type BdcRow = { branch_id: string; status: string; order_reviewed_at: string | null; balances_ok_at: string | null; revenue_confirmed_at: string | null; closed_at: string | null };
  const bdcByBranch = new Map<string, BdcRow>((bdcToday as BdcRow[] | null ?? []).map((r) => [r.branch_id, r]));

  const branchStatus: ReconBranchStatus[] = branchList.map((b, i) => {
    const p = pendingByBranch.get(b.id) ?? { n: 0, cents: 0 };
    const hasActivity = activityByBranch.has(b.id);
    const rec = bdcByBranch.get(b.id) ?? null;
    let dayStatus: DayStatus;
    if (!hasActivity) dayStatus = 'no_activity';
    else if (rec && (rec.status === 'closed' || rec.closed_at)) dayStatus = 'closed';
    else if (rec && (rec.order_reviewed_at || rec.balances_ok_at || rec.revenue_confirmed_at)) dayStatus = 'in_progress';
    else dayStatus = 'open';
    return {
      id: b.id, code: b.code, name: b.name,
      cashClosed: cashClosedFlags[i],
      pendingConfirm: p.n, pendingConfirmCents: p.cents,
      hasActivity,
      dayStatus,
      overdueClose: overdueCloses[i],
    };
  });

  // --- Open tips (all branches) ---
  const { data: tips } = await supabase.from('tips').select('amount_cents').eq('status', 'open').is('settlement_id', null);
  const openTipsCount = tips?.length ?? 0;
  const openTipsCents = (tips ?? []).reduce((s, t) => s + t.amount_cents, 0);

  // --- Unsettled commission lines (paid/closed, commission-applicable) ---
  const { data: commItems } = await supabase
    .from('order_items')
    .select('id, status, service:service_items!order_items_service_item_id_fkey ( commission_applicable ), order:orders!order_items_order_id_fkey ( status )')
    .is('commission_settlement_id', null)
    .not('therapist_id', 'is', null);
  const unsettledCommissionLines = (commItems ?? []).filter(
    (it) => it.status !== 'cancelled' && one(it.service)?.commission_applicable && ['paid', 'closed'].includes(one(it.order)?.status ?? ''),
  ).length;

  // --- AR outstanding: same SOA-model as the AR Balance page (open-SOA
  // outstanding + un-stated closed AR, branch-scoped), so the dashboard card
  // and the page always show the same number. ---
  const arOutstandingCents = (await loadArBalance()).total_cents;

  // --- SOA: orders with unbilled AR folio lines (掛帳 not yet on a statement) ---
  let soaUnstated = 0;
  if (arId) {
    const { data: unbilled } = await supabase
      .from('folio_lines')
      .select('order_id')
      .eq('payment_method_id', arId)
      .in('kind', ['payment', 'refund'])
      .is('soa_session_id', null)
      .not('order_id', 'is', null);
    soaUnstated = new Set((unbilled ?? []).map((r) => r.order_id)).size;
  }

  return {
    today,
    branches: branchStatus,
    // No-activity branches don't owe a cash count today — exclude them so the
    // "All branches closed" message isn't blocked by quiet branches.
    cashNotClosed: branchStatus.filter((b) => !b.cashClosed && b.hasActivity).length,
    pendingConfirm: branchStatus.reduce((s, b) => s + b.pendingConfirm, 0),
    pendingConfirmCents: branchStatus.reduce((s, b) => s + b.pendingConfirmCents, 0),
    openTipsCount,
    openTipsCents,
    unsettledCommissionLines,
    arOutstandingCents,
    soaUnstated,
  };
}
