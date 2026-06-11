import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession } from '@/lib/auth';
import { pushGLEntry, attachFileToJournal, pushAPBill, attachFileToBill, loginWithServiceAccount, type GLLine, type APLine } from '@/lib/acumatica';

export const acumaticaConfigured = (): boolean => !!process.env.ACUMATICA_BASE_URL;

// All ERP posting runs under the shared service account (ACUMATICA_SERVICE_USERNAME
// / PASSWORD), which holds the GL/AP posting rights. A POS user's own ERP session
// is used only for login/authentication — not every user has voucher permission,
// so the actual post must go through the service account. Who triggered the post
// is still recorded on our side (erp_posting_log: posted_by_staff_id +
// acu_session_user_id); only the ERP "Created By" is the service account.

export type PostingTable = 'orders' | 'revenue_soa' | 'revenue_soa_payments' | 'tip_settlements' | 'shifts';

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
  /** Storage path of a proof file to attach to the posted GL entry (best
   *  effort — the journal is already posted if this fails). Defaults to the
   *  `ar-proofs` bucket; override with proofBucket. */
  proofPath?: string;
  proofBucket?: string;
  /** In-memory artefact (typically a rendered SOA / Revenue Confirm PDF) to
   *  attach to the posted GL entry alongside any storage proof. Best effort —
   *  same rule as proofPath: a failure here doesn't unwind the post. Pass a
   *  fresh ArrayBuffer (Node Buffer's underlying buffer may be a
   *  SharedArrayBuffer — copy into `new ArrayBuffer` if so). */
  renderedAttachment?: { filename: string; buffer: ArrayBuffer; mimeType: string };
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
    // Resolve inside the try so a missing/failed service login is recorded as a
    // retriable failed post (not an unhandled throw).
    const cookie = await loginWithServiceAccount();
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

    // Attach the proof (remittance slip / cash photo) to the posted journal.
    // Best effort: the GL post already succeeded; an attach failure leaves the
    // journal correct + the file still on our side, just not on the ERP entry.
    if (args.proofPath && res.batchNbr) {
      try {
        const bucket = args.proofBucket ?? 'ar-proofs';
        const dl = await supabase.storage.from(bucket).download(args.proofPath);
        if (dl.data) {
          const buf = await dl.data.arrayBuffer();
          const filename = args.proofPath.split('/').pop() ?? 'proof';
          await attachFileToJournal(
            { batchNbr: res.batchNbr, filename, fileBuffer: buf, mimeType: dl.data.type || 'application/octet-stream' },
            cookie,
          );
        }
      } catch (attachErr) {
        // We keep the original on our side; surface in the log row for Retry.
        const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
        console.error('[ERP attach] proof attach failed:', msg);
        if (log) {
          await supabase
            .from('erp_posting_log')
            .update({ error_message: `Posted (batch ${res.batchNbr}) but proof attach failed: ${msg}` })
            .eq('id', log.id);
        }
      }
    }

    // Attach the rendered source PDF (SOA / Revenue Confirm voucher) to the
    // posted journal so reviewers in Acumatica can see what produced the entry.
    // Same best-effort policy — attach failures don't unwind the post; the PDF
    // is always re-renderable from our side via the PDF download routes.
    if (args.renderedAttachment && res.batchNbr) {
      try {
        const ra = args.renderedAttachment;
        await attachFileToJournal(
          { batchNbr: res.batchNbr, filename: ra.filename, fileBuffer: ra.buffer, mimeType: ra.mimeType },
          cookie,
        );
      } catch (attachErr) {
        const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
        console.error('[ERP attach] rendered PDF attach failed:', msg);
        if (log) {
          await supabase
            .from('erp_posting_log')
            .update({ error_message: `Posted (batch ${res.batchNbr}) but rendered PDF attach failed: ${msg}` })
            .eq('id', log.id);
        }
      }
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

interface PostBillToErpArgs {
  /** Audit-log entity type, e.g. 'tip_settlement'. */
  entityType: string;
  /** Table that carries the posting columns. */
  table: PostingTable;
  entityId: string;
  /** Acumatica AP Bill fields. */
  vendor: string;
  vendorRef: string;
  date: string; // YYYY-MM-DD
  description: string;
  financialBranch: string;
  cashAccount: string;
  currency?: string;
  lines: APLine[];
  /** HHG-Acumatica required UDFs (Request Category / Payment or Liquidation). */
  requestCategory?: string;
  paymentOrLiquidation?: string;
  /** Attach this stored file to the posted bill (best effort). */
  proofPath?: string;
  proofBucket?: string;
}

/**
 * Post an AP Bill to Acumatica (mirrors postToErp but for AP, not GL). Same
 * rule: failure → posting_status='failed' + posting_error + log retriable;
 * success → posting_status='posted' + voucher number (the Bill ReferenceNbr,
 * stored in gl_batch_nbr) + log success + attach the detail PDF to the bill.
 * No-op until Acumatica is configured.
 */
export async function postBillToErp(args: PostBillToErpArgs): Promise<PostToErpResult> {
  const supabase = createServiceClient();
  const patchRow = (patch: Record<string, unknown>) =>
    (supabase.from(args.table) as unknown as {
      update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
    })
      .update(patch)
      .eq('id', args.entityId);

  if (!acumaticaConfigured()) return { ok: true, batchNbr: null, skipped: true };

  const session = await currentSession();

  await patchRow({ posting_status: 'posting', posting_error: null });
  const { data: log } = await supabase
    .from('erp_posting_log')
    .insert({
      entity_type: args.entityType,
      entity_id: args.entityId,
      status: 'pending',
      payload: {
        kind: 'ap_bill', vendor: args.vendor, vendor_ref: args.vendorRef, date: args.date,
        description: args.description, financial_branch: args.financialBranch,
        cash_account: args.cashAccount, currency: args.currency ?? 'PHP', lines: args.lines,
      } as never,
      posted_by_staff_id: session?.staffUserId ?? null,
      acu_session_user_id: session?.acumaticaUserId ?? null,
    })
    .select('id')
    .single();

  try {
    // Resolve inside the try (see postToErp) so a service-login failure is a
    // retriable failed post, not an unhandled throw.
    const cookie = await loginWithServiceAccount();
    const res = await pushAPBill(
      {
        vendor: args.vendor, vendor_ref: args.vendorRef, date: args.date,
        description: args.description, financial_branch: args.financialBranch,
        cash_account: args.cashAccount, currency: args.currency ?? 'PHP', lines: args.lines,
        request_category: args.requestCategory,
        payment_or_liquidation: args.paymentOrLiquidation,
      },
      cookie,
    );
    const ref = res.refNbr;
    await patchRow({ posting_status: 'posted', gl_batch_nbr: ref, posting_error: null });
    if (log) {
      await supabase
        .from('erp_posting_log')
        .update({ status: 'success', batch_nbr: ref, erp_response: res.raw as never })
        .eq('id', log.id);
    }

    // Attach the detail PDF to the bill. Best-effort: bill is already posted.
    if (args.proofPath && ref) {
      try {
        const bucket = args.proofBucket ?? 'tip-pdfs';
        const dl = await supabase.storage.from(bucket).download(args.proofPath);
        if (dl.data) {
          const buf = await dl.data.arrayBuffer();
          const filename = args.proofPath.split('/').pop() ?? 'attachment.pdf';
          await attachFileToBill(
            { refNbr: ref, filename, fileBuffer: buf, mimeType: dl.data.type || 'application/pdf' },
            cookie,
          );
        }
      } catch (attachErr) {
        const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
        console.error('[ERP attach] bill attach failed:', msg);
        if (log) {
          await supabase
            .from('erp_posting_log')
            .update({ error_message: `Posted (ref ${ref}) but attach failed: ${msg}` })
            .eq('id', log.id);
        }
      }
    }
    return { ok: true, batchNbr: ref };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'AP posting failed';
    await patchRow({ posting_status: 'failed', posting_error: error });
    if (log) {
      await supabase.from('erp_posting_log').update({ status: 'failed', error_message: error }).eq('id', log.id);
    }
    return { ok: false, error };
  }
}
