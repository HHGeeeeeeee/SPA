import { redirect } from 'next/navigation';
import { getAllowedBranches } from '@/lib/branch-access';
import { currentSession, isManager } from '@/lib/auth';
import { ReportBuilder } from '@/components/report-builder/report-builder';

export const dynamic = 'force-dynamic';

export default async function ReportBuilderPage() {
  if (!isManager(await currentSession())) redirect('/dashboard');
  const branches = await getAllowedBranches();
  return <ReportBuilder branches={branches} />;
}