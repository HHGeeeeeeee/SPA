import { createServiceClient } from '@/lib/supabase/server';
import { SoaWorkspace, type SoaHistoryRow } from '@/components/reconciliation/soa-workspace';
import { loadSoaWorkspace } from '@/app/(dashboard)/reconciliation/soa/actions';

export const dynamic = 'force-dynamic';

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Default range: first of the current month (PHT) → today.
function defaultRange(): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { from: `${parts.slice(0, 7)}-01`, to: parts };
}

async function fetchHistory(): Promise<SoaHistoryRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('revenue_soa')
    .select('id, soa_no, status, settlement_type, period_from, period_to, total_cents, billing:billing_destinations!revenue_soa_billing_to_id_fkey ( code, name )')
    .order('created_at', { ascending: false });
  return (data ?? []).map((s) => {
    const b = one(s.billing);
    return {
      id: s.id, soa_no: s.soa_no, status: s.status, settlement_type: s.settlement_type,
      period_from: s.period_from, period_to: s.period_to, total_cents: s.total_cents,
      billing_code: b?.code ?? null, billing_name: b?.name ?? null,
    };
  });
}

export default async function RevenueSoaPage() {
  const { from, to } = defaultRange();
  const [groups, history] = await Promise.all([loadSoaWorkspace(from, to), fetchHistory()]);

  return (
    <SoaWorkspace initialFrom={from} initialTo={to} initialGroups={groups} history={history} />
  );
}
