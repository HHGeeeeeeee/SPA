import 'server-only';

import { createServiceClient } from '@/lib/supabase/server';
import { postToErp, type PostToErpResult } from '@/lib/erp-posting';
import type { GLLine } from '@/lib/acumatica';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const SUB_FALLBACK = '000000000';

interface TxCodeJoin {
  code: string;
  debit_account: string | null;
  debit_subaccount: string | null;
  debit_branch_id: string | null;
  credit_account: string | null;
  credit_subaccount: string | null;
  credit_branch_id: string | null;
}

// payment / revenue / tip post the code in its natural DR→CR direction; a
// refund reverses it. A revenue adjustment can also be inherently negative
// (Adjust charge stores a negative amount) — same reversal rule.
const signed = (kind: string, cents: number): number => (kind === 'refund' ? -cents : cents);

/**
 * Translate a shift's folio lines into GL lines 1:1 — every folio line becomes
 * its own DR/CR pair, NO netting/aggregation, so the posted voucher mirrors the
 * folio ledger exactly (a payment and its refund both appear, as opposing
 * pairs). Each detail carries the source document (order no / SOA no) on
 * RefNumber + description. Accounts come from the line's transaction code; a
 * negative line (refund / downward adjustment) posts with the code's DR/CR
 * legs swapped so amounts stay positive. The per-leg branch was decided at
 * TRANSACTION time and stamped on the line (dr_branch / cr_branch) — legacy
 * lines without it fall back to the code's branch override, then the shift's
 * branch.
 */
async function buildShiftGlLines(
  supabase: ReturnType<typeof createServiceClient>,
  shiftId: string,
  shiftBranchCode: string,
): Promise<GLLine[]> {
  const { data: lines } = await supabase
    .from('folio_lines')
    .select('amount_cents, kind, posted_at, transaction_code_id, dr_branch, cr_branch, code:transaction_codes ( code, debit_account, debit_subaccount, debit_branch_id, credit_account, credit_subaccount, credit_branch_id ), order:orders!folio_lines_order_id_fkey ( order_no ), soa:revenue_soa!folio_lines_soa_session_id_fkey ( soa_no )')
    .eq('shift_id', shiftId)
    .not('transaction_code_id', 'is', null)
    .order('posted_at', { ascending: true });
  if (!lines || lines.length === 0) return [];

  const gl: GLLine[] = [];
  for (const l of lines) {
    const tx = one(l.code) as TxCodeJoin | null;
    if (!tx || !l.transaction_code_id) continue;
    const v = signed(l.kind, l.amount_cents);
    if (v === 0) continue;
    const drBranch = l.dr_branch?.trim() || tx.debit_branch_id?.trim() || shiftBranchCode;
    const crBranch = l.cr_branch?.trim() || tx.credit_branch_id?.trim() || shiftBranchCode;
    const ref = (one(l.order) as { order_no: string } | null)?.order_no
      ?? (one(l.soa) as { soa_no: string } | null)?.soa_no
      ?? '';
    const positive = v > 0;
    const value = Math.abs(v) / 100;
    // Natural direction for a positive line; a negative one (refund / downward
    // adjustment) swaps the legs so the reversal is explicit in the voucher.
    const dr = positive
      ? { account: tx.debit_account, sub: tx.debit_subaccount, branch: drBranch }
      : { account: tx.credit_account, sub: tx.credit_subaccount, branch: crBranch };
    const cr = positive
      ? { account: tx.credit_account, sub: tx.credit_subaccount, branch: crBranch }
      : { account: tx.debit_account, sub: tx.debit_subaccount, branch: drBranch };
    if (!dr.account || !cr.account) continue; // code missing an account — skip rather than post a half entry
    const reversal = positive ? '' : l.kind === 'refund' ? ' (refund)' : ' (reversal)';
    const desc = `${tx.code}${ref ? ` · ${ref}` : ''}${reversal}`;
    gl.push({ account: dr.account, sub_account: dr.sub ?? SUB_FALLBACK, branch: dr.branch, debit_amount: value, credit_amount: null, transaction_desc: desc, ref_number: ref || null });
    gl.push({ account: cr.account, sub_account: cr.sub ?? SUB_FALLBACK, branch: cr.branch, debit_amount: null, credit_amount: value, transaction_desc: desc, ref_number: ref || null });
  }
  return gl;
}

export type ShiftPostResult = PostToErpResult & { reason?: string };

/**
 * Post one shift's remittance to ERP as a single GL journal. Idempotent: a shift
 * already posted is skipped. A shift with no coded folio lines is a no-op. The
 * shift row carries posting_status / gl_batch_nbr / posting_error via postToErp,
 * so a failure is retriable without re-opening the shift.
 */
export async function postShiftToErp(shiftId: string): Promise<ShiftPostResult> {
  const supabase = createServiceClient();
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, branch_id, business_date, label, status, posting_status, branch:branches ( code )')
    .eq('id', shiftId)
    .maybeSingle();
  if (!shift) return { ok: false, error: 'Shift not found' };
  if (shift.status !== 'closed') return { ok: false, error: 'Shift must be closed before posting' };
  if (shift.posting_status === 'posted') return { ok: true, batchNbr: null, skipped: true, reason: 'already posted' };

  const branchCode = one(shift.branch as { code: string } | { code: string }[] | null)?.code ?? '';
  const lines = await buildShiftGlLines(supabase, shift.id, branchCode);
  if (lines.length === 0) return { ok: true, batchNbr: null, skipped: true, reason: 'nothing to post' };

  return postToErp({
    entityType: 'shift_remittance',
    table: 'shifts',
    entityId: shift.id,
    date: shift.business_date,
    branch: branchCode,
    description: `Sales remittance · ${shift.label}`,
    lines,
  });
}
