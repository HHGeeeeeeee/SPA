import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { isDayCashClosed } from '@/app/(dashboard)/reconciliation/cash/actions';
import { loadArBalance } from '@/app/(dashboard)/reconciliation/soa/actions';
import { getOldestOverdueClose, type OverdueClose } from '@/lib/business-day';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface ReconBranchStatus {
  id: string;
  code: string;
  name: string;
  cashClosed: boolean;
  pendingConfirm: number;
  pendingConfirmCents: number;
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

  // --- Today's orders pending Revenue Confirm (per branch) ---
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('branch_id, status, total_cents, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
    .eq('service_date', today)
    .is('deleted_at', null)
    .in('status', ['paid', 'completed']);
  const pendingByBranch = new Map<string, { n: number; cents: number }>();
  for (const o of todayOrders ?? []) {
    const isAR = !!arId && one(o.billing)?.default_payment_method_id === arId;
    if (!(o.status === 'paid' || (o.status === 'completed' && isAR))) continue;
    const cur = pendingByBranch.get(o.branch_id) ?? { n: 0, cents: 0 };
    cur.n += 1; cur.cents += o.total_cents;
    pendingByBranch.set(o.branch_id, cur);
  }

  // --- Cash closed per branch (today) + oldest overdue EoD close ---
  const [cashClosedFlags, overdueCloses] = await Promise.all([
    Promise.all(branchList.map((b) => isDayCashClosed(b.id, today))),
    Promise.all(branchList.map((b) => getOldestOverdueClose(b.id))),
  ]);
  const branchStatus: ReconBranchStatus[] = branchList.map((b, i) => {
    const p = pendingByBranch.get(b.id) ?? { n: 0, cents: 0 };
    return {
      id: b.id, code: b.code, name: b.name,
      cashClosed: cashClosedFlags[i],
      pendingConfirm: p.n, pendingConfirmCents: p.cents,
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

  // --- SOA: closed AR orders not yet on a statement ---
  let soaUnstated = 0;
  if (arId) {
    const [{ data: closedAr }, { data: taken }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, billing:billing_destinations!orders_billing_to_id_fkey ( default_payment_method_id )')
        .eq('status', 'closed').is('deleted_at', null),
      supabase.from('revenue_soa_orders').select('order_id'),
    ]);
    const takenIds = new Set((taken ?? []).map((t) => t.order_id));
    soaUnstated = (closedAr ?? []).filter((o) => one(o.billing)?.default_payment_method_id === arId && !takenIds.has(o.id)).length;
  }

  return {
    today,
    branches: branchStatus,
    cashNotClosed: branchStatus.filter((b) => !b.cashClosed).length,
    pendingConfirm: branchStatus.reduce((s, b) => s + b.pendingConfirm, 0),
    pendingConfirmCents: branchStatus.reduce((s, b) => s + b.pendingConfirmCents, 0),
    openTipsCount,
    openTipsCents,
    unsettledCommissionLines,
    arOutstandingCents,
    soaUnstated,
  };
}
