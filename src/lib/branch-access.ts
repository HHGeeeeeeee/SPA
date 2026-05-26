import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isAdmin } from '@/lib/auth';

export interface BranchOpt { id: string; code: string; name: string }

/**
 * Branches the current user may see / act on:
 *  - admin → all active branches
 *  - everyone else → their home branch + any assigned via staff_user_branches
 * Drives branch selectors and server-side access checks so each branch only
 * handles its own data.
 */
export async function getAllowedBranches(): Promise<BranchOpt[]> {
  const session = await currentSession();
  if (!session) return [];
  const supabase = createServiceClient();

  if (isAdmin(session)) {
    const { data } = await supabase.from('branches').select('id, code, name').eq('active', true).order('code');
    return data ?? [];
  }

  const ids = new Set<string>();
  if (session.homeBranchId) ids.add(session.homeBranchId);
  const { data: links } = await supabase.from('staff_user_branches').select('branch_id').eq('staff_user_id', session.staffUserId);
  for (const l of links ?? []) ids.add(l.branch_id);
  if (ids.size === 0) return [];

  const { data } = await supabase.from('branches').select('id, code, name').eq('active', true).in('id', [...ids]).order('code');
  return data ?? [];
}

/** Set of branch ids the current user may access. */
export async function getAllowedBranchIds(): Promise<Set<string>> {
  return new Set((await getAllowedBranches()).map((b) => b.id));
}

/** True if the current user may act on this branch (admin → always). */
export async function canAccessBranch(branchId: string): Promise<boolean> {
  const session = await currentSession();
  if (!session) return false;
  if (isAdmin(session)) return true;
  return (await getAllowedBranchIds()).has(branchId);
}
