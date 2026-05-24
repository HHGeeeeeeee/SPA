import { createServiceClient } from '@/lib/supabase/server';
import { CommissionSettlementWorkspace, type CommHistoryRow } from '@/components/reconciliation/commission-settlement-workspace';
import { loadCommissionGroups } from './actions';

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

export default async function CommissionSettlementPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const { data: branches } = await supabase.from('branches').select('id, code, name').eq('active', true).order('code');
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id ?? '';
  const { from, to } = halfMonthRange();

  const [groups, histRes] = await Promise.all([
    branchId ? loadCommissionGroups(branchId, from, to) : Promise.resolve([]),
    supabase
      .from('commission_periods')
      .select('id, period_no, status, period_from, period_to, total_sessions, total_commission_cents, confirmed_at, branch:branches!commission_periods_branch_id_fkey ( code ), commission_entries ( therapist:employees!commission_entries_therapist_id_fkey ( name ) )')
      .order('created_at', { ascending: false }),
  ]);
  const history: CommHistoryRow[] = (histRes.data ?? []).map((p) => ({
    id: p.id, period_no: p.period_no, status: p.status,
    period_from: p.period_from, period_to: p.period_to,
    total_sessions: p.total_sessions ?? 0, total_commission_cents: p.total_commission_cents ?? 0,
    branch_code: one(p.branch)?.code ?? null,
    confirmed_at: p.confirmed_at,
    therapists: (p.commission_entries ?? []).map((e) => one(e.therapist)?.name).filter(Boolean) as string[],
  }));

  if (!branchId) {
    return <div className="p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</div>;
  }

  return (
    <CommissionSettlementWorkspace
      branches={list}
      initialBranchId={branchId}
      initialFrom={from}
      initialTo={to}
      initialGroups={groups}
      history={history}
    />
  );
}
