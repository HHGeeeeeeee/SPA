import { redirect } from 'next/navigation';

import { currentSession, canAccessSettings } from '@/lib/auth';

/**
 * Settings is a manager+ / accountant area. Staff and external_booker get
 * redirected to /dashboard before any sub-page renders. Admin-only sub-pages
 * (Users, Audit Log) layer their own stricter guard on top.
 *
 * Wrapping the whole /settings tree from one layout means we don't have to
 * sprinkle per-page guards into all ~18 sub-pages, and a future sub-page
 * added without thinking about role still inherits the gate.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!canAccessSettings(await currentSession())) redirect('/dashboard');
  return children;
}
