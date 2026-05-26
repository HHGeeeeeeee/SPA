import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
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
  const branches = await getAllowedBranches();
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id ?? '';
  const { from, to } = halfMonthRange();

  const [groups, histRes] = await Promise.all([
    branchId ? loadCommissionGroups(branchId, from, to) : Promise.resolve([]),
    supabase
      .from('commission_periods')
      .select('id, period_no, status, period_from, period_to, total_sessions, total_commission_cents, confirmed_at, branch:branches!commission_periods_branch_id_fkey ( code ), items:order_items!fk_order_items_commission_period ( list_price_cents, commission_rate, commission_amount_cents, status, actual_start, therapist:employees!order_items_therapist_id_fkey ( name ), order:orders!order_items_order_id_fkey ( order_no, service_date ), service:service_items!order_items_service_item_id_fkey ( name ) )')
      .order('created_at', { ascending: false }),
  ]);
  type AccLine = { service_date: string; order_no: string; service: string; gross_cents: number; rate: number; commission_cents: number; actual_start: string };
  const history: CommHistoryRow[] = (histRes.data ?? []).map((p) => {
    // Group the period's settled service lines by therapist, listing each order.
    const byTh = new Map<string, { therapist: string; sessions: number; gross_cents: number; commission_cents: number; lines: AccLine[] }>();
    for (const it of (p.items ?? []).filter((i) => i.status !== 'cancelled')) {
      const th = one(it.therapist)?.name ?? '—';
      const g = byTh.get(th) ?? { therapist: th, sessions: 0, gross_cents: 0, commission_cents: 0, lines: [] };
      g.sessions += 1;
      g.gross_cents += it.list_price_cents ?? 0;
      g.commission_cents += it.commission_amount_cents ?? 0;
      g.lines.push({
        service_date: one(it.order)?.service_date ?? '', order_no: one(it.order)?.order_no ?? '—',
        service: one(it.service)?.name ?? 'Service', gross_cents: it.list_price_cents ?? 0,
        rate: Number(it.commission_rate ?? 0), commission_cents: it.commission_amount_cents ?? 0,
        actual_start: it.actual_start ?? '',
      });
      byTh.set(th, g);
    }
    const detail = [...byTh.values()]
      .map((g) => {
        // Warm-up = the therapist's earliest session each calendar day (occurrence 1).
        const earliest = new Map<string, string>();
        for (const l of g.lines) {
          const cur = earliest.get(l.service_date);
          if (l.actual_start && (!cur || l.actual_start < cur)) earliest.set(l.service_date, l.actual_start);
        }
        const lines = g.lines
          .map((l) => ({ service_date: l.service_date, order_no: l.order_no, service: l.service, gross_cents: l.gross_cents, rate: l.rate, commission_cents: l.commission_cents, warmup: !!l.actual_start && l.actual_start === earliest.get(l.service_date) }))
          .sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
        return { therapist: g.therapist, sessions: g.sessions, gross_cents: g.gross_cents, commission_cents: g.commission_cents, lines };
      })
      .sort((a, b) => b.commission_cents - a.commission_cents);
    return {
      id: p.id, period_no: p.period_no, status: p.status,
      period_from: p.period_from, period_to: p.period_to,
      total_sessions: p.total_sessions ?? 0, total_commission_cents: p.total_commission_cents ?? 0,
      branch_code: one(p.branch)?.code ?? null,
      confirmed_at: p.confirmed_at,
      therapists: detail.map((g) => g.therapist),
      detail,
    };
  });

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
