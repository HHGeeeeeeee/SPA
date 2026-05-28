import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession } from '@/lib/auth';
import { readAcuSessionCookie } from '@/lib/session';
import { pushGLEntry, type GLLine } from '@/lib/acumatica';

export const acumaticaConfigured = (): boolean => !!process.env.ACUMATICA_BASE_URL;

export type PostingTable = 'orders' | 'revenue_soa' | 'tip_settlements';

interface PostToErpArgs {
  /** Audit-log entity type, e.g. 'revenue_confirm' | 'soa_settle' | 'tip_settlement'. */
  entityType: string;
  /** Table that carries the posting columns (posting_status / gl_batch_nbr / posting_error). */
  table: PostingTable;
  entityId: string;
  /** GL journal entry. */
  date: string; // YYYY-MM-DD
  branch: string; // Acumatica branch code
  description: string;
  lines: GLLine[];
  /** Optional lifecycle-status transition on the same row. */
  statusColumn?: string;
  fromStatus?: string; // reverted to on failure
  toStatus?: string; // advanced to on success
  /** Extra columns to set on the row alongside the success transition
   *  (e.g. paid_cents / outstanding_cents on a settle). */
  extraOnSuccess?: Record<string, unknown>;
}

export type PostToErpResult =
  | { ok: true; batchNbr: string | null; skipped?: boolean }
  | { ok: false; error: string };

/**
 * The single entry point for ERP/GL posting. Contract (system-wide rule):
 *  - FAILURE → revert the row to its prior status, note the error
 *    (posting_status='failed' + posting_error), and log a failed, retriable
 *    attempt in erp_posting_log.
 *  - SUCCESS → advance the status, write the voucher number
 *    (posting_status='posted' + gl_batch_nbr), and log the success.
 *
 * Until Acumatica is configured (ACUMATICA_BASE_URL unset) it skips the GL call
 * and only performs the status transition — so pre-integration flows keep
 * working and nothing is left stuck mid-post.
 */
export async function postToErp(args: PostToErpArgs): Promise<PostToErpResult> {
  const supabase = createServiceClient();
  const statusCol = args.statusColumn ?? 'status';
  // The new posting columns aren't in the generated DB types yet; cast the
  // dynamic-table update to keep this loosely typed until types are regenerated.
  const patchRow = (patch: Record<string, unknown>) =>
    (supabase.from(args.table) as unknown as {
      update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
    })
      .update(patch)
      .eq('id', args.entityId);

  // Not wired to Acumatica yet → just do the status transition (+ any success
  // side-effects like paid_cents), no GL post, no batch number.
  if (!acumaticaConfigured()) {
    const patch: Record<string, unknown> = { ...(args.extraOnSuccess ?? {}) };
    if (args.toStatus) patch[statusCol] = args.toStatus;
    if (Object.keys(patch).length > 0) await patchRow(patch);
    return { ok: true, batchNbr: null, skipped: true };
  }

  const session = await currentSession();
  const cookie = await readAcuSessionCookie();

  // Intermediate state + a pending log row (so a crash mid-post is visible).
  await patchRow({ posting_status: 'posting', posting_error: null });
  const { data: log } = await supabase
    .from('erp_posting_log')
    .insert({
      entity_type: args.entityType,
      entity_id: args.entityId,
      status: 'pending',
      payload: { date: args.date, branch: args.branch, description: args.description, lines: args.lines } as never,
      posted_by_staff_id: session?.staffUserId ?? null,
      acu_session_user_id: session?.acumaticaUserId ?? null,
    })
    .select('id')
    .single();

  try {
    const res = await pushGLEntry(
      { date: args.date, description: args.description, currency: 'PHP', branch: args.branch, lines: args.lines },
      cookie,
    );
    const patch: Record<string, unknown> = { posting_status: 'posted', gl_batch_nbr: res.batchNbr, posting_error: null, ...(args.extraOnSuccess ?? {}) };
    if (args.toStatus) patch[statusCol] = args.toStatus;
    await patchRow(patch);
    if (log) {
      await supabase
        .from('erp_posting_log')
        .update({ status: 'success', batch_nbr: res.batchNbr, erp_response: res.raw as never })
        .eq('id', log.id);
    }
    return { ok: true, batchNbr: res.batchNbr };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'ERP posting failed';
    const patch: Record<string, unknown> = { posting_status: 'failed', posting_error: error };
    if (args.fromStatus) patch[statusCol] = args.fromStatus; // revert
    await patchRow(patch);
    if (log) {
      await supabase.from('erp_posting_log').update({ status: 'failed', error_message: error }).eq('id', log.id);
    }
    return { ok: false, error };
  }
}
