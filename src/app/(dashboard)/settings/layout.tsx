import { redirect } from 'next/navigation';

import { currentSession, isManager } from '@/lib/auth';

/**
 * Settings is a manager+ area. Staff and external_booker get redirected to
 * /dashboard before any sub-page renders — no Branches list, no Service Items
 * price list, no Employees roster leaking out. Admin-only sub-pages (Users,
 * Audit Log) layer their own stricter guard on top.
 *
 * Wrapping the whole /settings tree from one layout means we don't have to
 * sprinkle `if (!isManager(...)) redirect(...)` into all ~18 sub-pages, and a
 * future sub-page added without thinking about role still inherits the gate.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isManager(await currentSession())) redirect('/dashboard');
  return children;
}
