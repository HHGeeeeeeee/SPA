import { SoaWorkspace } from '@/components/reconciliation/soa-workspace';
import { loadSoaWorkspace, loadSoaHistory, loadArBalance } from '@/app/(dashboard)/reconciliation/soa/actions';

export const dynamic = 'force-dynamic';

// Default range: first of the current month (PHT) → today.
function defaultRange(): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { from: `${parts.slice(0, 7)}-01`, to: parts };
}

export default async function RevenueSoaPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { from, to } = defaultRange();
  const view = (await searchParams)?.view;
  // AR Balance is the default landing view; ?view=generate / history opt into the others.
  const initialView = view === 'generate' ? 'generate' : view === 'history' ? 'history' : 'ar';
  const [groups, history, arBalance] = await Promise.all([
    loadSoaWorkspace(from, to),
    loadSoaHistory(),
    loadArBalance(),
  ]);

  return (
    <SoaWorkspace
      initialFrom={from}
      initialTo={to}
      today={to}
      initialGroups={groups}
      history={history}
      arBalance={arBalance}
      initialView={initialView}
    />
  );
}
