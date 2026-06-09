import { redirect } from 'next/navigation';

import { SystemCompareReport } from '@/components/system-compare/system-compare-report';
import { currentSession, isManager } from '@/lib/auth';

export const metadata = { title: 'System Compare' };

export default async function SystemComparePage() {
  // Internal strategy/pricing doc — manager+ only, matching Report Builder.
  if (!isManager(await currentSession())) redirect('/dashboard');
  return <SystemCompareReport />;
}
