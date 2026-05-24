import { createServiceClient } from '@/lib/supabase/server';
import { EodPipeline } from '@/components/reconciliation/eod-pipeline';
import { loadEod } from './actions';

export const dynamic = 'force-dynamic';

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function EndOfDayPage({ searchParams }: { searchParams: Promise<{ branch?: string; date?: string }> }) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const { data: branches } = await supabase.from('branches').select('id, code, name').eq('active', true).order('code');
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id ?? '';
  const date = sp.date || todayPHT();

  if (!branchId) {
    return <div className="p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</div>;
  }

  const view = await loadEod(branchId, date);
  return <EodPipeline branches={list} initialBranchId={branchId} initialDate={date} initialView={view} />;
}
