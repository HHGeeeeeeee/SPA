import 'server-only';
import bcrypt from 'bcryptjs';

import { createServiceClient } from '@/lib/supabase/server';

/**
 * Inline-approval helper for staff-side actions that need a manager's
 * sign-off without making the manager log in (e.g. waive-charge interrupt,
 * future: high-percent discount approval, void payment, reopen order).
 *
 * Flow: staff submits action with `manager_user_id` + `manager_pin` →
 * server hands them to this helper → on match, the staff-side action
 * proceeds with the approver recorded on the audit trail.
 *
 * Throttling:
 *   - 5 wrong attempts within the window → locks the manager's PIN for
 *     15 minutes. Failures and lock-state live on staff_users itself
 *     (manager_pin_failed_attempts, manager_pin_locked_until columns —
 *     pre-existing schema, finally getting wired up).
 *   - Successful match resets the counter.
 *
 * The picked manager MUST be active + actually role=manager-or-admin + have
 * a PIN set. Otherwise we fail with a generic message — same wording on
 * "wrong user", "wrong PIN", and "no PIN" to avoid leaking which manager
 * has set a PIN.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export type PinResult =
  | { ok: true; approverUserId: string; approverName: string }
  | { ok: false; error: string };

export async function verifyManagerPin(managerUserId: string, pin: string): Promise<PinResult> {
  const sb = createServiceClient();
  const { data: user } = await sb
    .from('staff_users')
    .select('id, display_name, role, active, manager_pin_hash, manager_pin_failed_attempts, manager_pin_locked_until')
    .eq('id', managerUserId)
    .maybeSingle();

  // Generic refusal — same wording for missing user / wrong role / no PIN /
  // wrong PIN, so a staff member can't probe which manager has a PIN by
  // watching error variants.
  const generic = 'Invalid manager or PIN';

  if (!user || !user.active) return { ok: false, error: generic };
  if (user.role !== 'manager' && user.role !== 'admin') return { ok: false, error: generic };
  if (!user.manager_pin_hash) return { ok: false, error: generic };

  // Lock check — explicit message because the user themselves needs to
  // know they're locked out (different audience than the probing case).
  if (user.manager_pin_locked_until && new Date(user.manager_pin_locked_until) > new Date()) {
    const until = new Date(user.manager_pin_locked_until).toLocaleTimeString('en-PH', {
      timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit',
    });
    return { ok: false, error: `Manager PIN locked until ${until} (too many wrong attempts)` };
  }

  const match = await bcrypt.compare(pin, user.manager_pin_hash);

  if (!match) {
    const fails = (user.manager_pin_failed_attempts ?? 0) + 1;
    const update: { manager_pin_failed_attempts: number; manager_pin_locked_until?: string } = {
      manager_pin_failed_attempts: fails,
    };
    if (fails >= MAX_ATTEMPTS) {
      update.manager_pin_locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    }
    await sb.from('staff_users').update(update).eq('id', user.id);
    return { ok: false, error: generic };
  }

  // Success — clear the fail counter so we don't carry forward yesterday's
  // typos into today's lock threshold.
  if ((user.manager_pin_failed_attempts ?? 0) > 0 || user.manager_pin_locked_until) {
    await sb.from('staff_users')
      .update({ manager_pin_failed_attempts: 0, manager_pin_locked_until: null })
      .eq('id', user.id);
  }

  return { ok: true, approverUserId: user.id, approverName: user.display_name ?? '' };
}

/** List managers + admins who are active AND have a PIN set — drives the
 *  "Manager" dropdown on the PIN entry UI. Returns a minimal shape so we
 *  don't leak more than name+id into the client. */
export async function listPinCapableManagers(): Promise<{ id: string; name: string }[]> {
  const sb = createServiceClient();
  const { data } = await sb
    .from('staff_users')
    .select('id, display_name, role, active, manager_pin_hash')
    .in('role', ['manager', 'admin'])
    .eq('active', true)
    .not('manager_pin_hash', 'is', null)
    .order('display_name');
  return (data ?? []).map((u) => ({ id: u.id, name: u.display_name ?? u.id }));
}
