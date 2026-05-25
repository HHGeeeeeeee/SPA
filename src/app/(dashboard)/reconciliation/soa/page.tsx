import { SoaWorkspace } from '@/components/reconciliation/soa-workspace';
import { loadSoaWorkspace, loadSoaHistory } from '@/app/(dashboard)/reconciliation/soa/actions';

export const dynamic = 'force-dynamic';

// Default range: first of the current month (PHT) → today.
function defaultRange(): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { from: `${parts.slice(0, 7)}-01`, to: parts };
}

export default async function RevenueSoaPage() {
  const { from, to } = defaultRange();
  const [groups, history] = await Promise.all([loadSoaWorkspace(from, to), loadSoaHistory()]);

  return (
    <SoaWorkspace initialFrom={from} initialTo={to} today={to} initialGroups={groups} history={history} />
  );
}
