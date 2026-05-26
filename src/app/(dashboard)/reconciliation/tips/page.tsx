import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { TipSettlementWorkspace, type TipHistoryRow } from '@/components/reconciliation/tip-settlement-workspace';
import { loadOpenTipGroups } from './actions';

export const dynamic = 'force-dynamic';

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Default range: the current half-month (1–15 or 16–EOM) in PHT.
function halfMonthRange(): { from: string; to: string } {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  if (d <= 15) return { from: `${y}-${mm}-01`, to: `${y}-${mm}-15` };
  const eom = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${mm}-16`, to: `${y}-${mm}-${String(eom).padStart(2, '0')}` };
}

export default async function TipSettlementPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const branches = await getAllowedBranches();
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id ?? '';
  const { from, to } = halfMonthRange();

  const [groups, histRes] = await Promise.all([
    branchId ? loadOpenTipGroups(branchId, from, to) : Promise.resolve([]),
    supabase
      .from('tip_settlements')
      .select('id, settlement_no, status, period_from, period_to, subtotal_cents, posted_at, branch:branches!tip_settlements_branch_id_fkey ( code ), tips ( amount_cents, therapist:employees!tips_therapist_id_fkey ( name ), order:orders!tips_order_id_fkey ( order_no, service_date ) )')
      .order('created_at', { ascending: false }),
  ]);
  const history: TipHistoryRow[] = (histRes.data ?? []).map((s) => {
    const lines = (s.tips ?? [])
      .map((t) => ({ therapist: one(t.therapist)?.name ?? '—', service_date: one(t.order)?.service_date ?? '', order_no: one(t.order)?.order_no ?? '—', amount_cents: t.amount_cents }))
      .sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
    return {
      id: s.id, settlement_no: s.settlement_no, status: s.status,
      period_from: s.period_from, period_to: s.period_to, subtotal_cents: s.subtotal_cents,
      posted_at: s.posted_at, branch_code: one(s.branch)?.code ?? null,
      therapists: [...new Set(lines.map((l) => l.therapist))],
      lines,
    };
  });

  if (!branchId) {
    return <div className="p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</div>;
  }

  return (
    <TipSettlementWorkspace
      branches={list}
      initialBranchId={branchId}
      initialFrom={from}
      initialTo={to}
      initialGroups={groups}
      history={history}
    />
  );
}
