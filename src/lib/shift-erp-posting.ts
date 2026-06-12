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
// refund reverses it. Net per group therefore = Σ amount with refunds negative.
const signed = (kind: string, cents: number): number => (kind === 'refund' ? -cents : cents);

/**
 * Aggregate a shift's folio lines into balanced GL lines: one DR/CR pair per
 * (transaction code × DR branch × CR branch), netting payments/revenue/tips
 * against refunds. Accounts come from the code; the per-leg branch was decided
 * at TRANSACTION time and stamped on the line (dr_branch / cr_branch) — legacy
 * lines without it fall back to the code's branch override, then the shift's
 * branch. A group whose net is negative posts with its DR/CR legs swapped so
 * amounts stay positive.
 */
async function buildShiftGlLines(
  supabase: ReturnType<typeof createServiceClient>,
  shiftId: string,
  shiftBranchCode: string,
): Promise<GLLine[]> {
  const { data: lines } = await supabase
    .from('folio_lines')
    .select('amount_cents, kind, transaction_code_id, dr_branch, cr_branch, code:transaction_codes ( code, debit_account, debit_subaccount, debit_branch_id, credit_account, credit_subaccount, credit_branch_id )')
    .eq('shift_id', shiftId)
    .not('transaction_code_id', 'is', null);
  if (!lines || lines.length === 0) return [];

  // Net by (code, DR branch, CR branch), keeping the code's accounts alongside.
  const byGroup = new Map<string, { net: number; tx: TxCodeJoin; drBranch: string; crBranch: string }>();
  for (const l of lines) {
    const tx = one(l.code) as TxCodeJoin | null;
    if (!tx || !l.transaction_code_id) continue;
    const drBranch = l.dr_branch?.trim() || tx.debit_branch_id?.trim() || shiftBranchCode;
    const crBranch = l.cr_branch?.trim() || tx.credit_branch_id?.trim() || shiftBranchCode;
    const key = `${l.transaction_code_id}|${drBranch}|${crBranch}`;
    const cur = byGroup.get(key) ?? { net: 0, tx, drBranch, crBranch };
    cur.net += signed(l.kind, l.amount_cents);
    byGroup.set(key, cur);
  }

  const gl: GLLine[] = [];
  for (const { net, tx, drBranch, crBranch } of byGroup.values()) {
    if (net === 0) continue;
    const positive = net > 0;
    const value = Math.abs(net) / 100;
    // Normal direction (net>0): DR debit account / CR credit account. Net<0
    // (refund-heavy): swap so the journal still posts positive amounts.
    const dr = positive
      ? { account: tx.debit_account, sub: tx.debit_subaccount, branch: drBranch }
      : { account: tx.credit_account, sub: tx.credit_subaccount, branch: crBranch };
    const cr = positive
      ? { account: tx.credit_account, sub: tx.credit_subaccount, branch: crBranch }
      : { account: tx.debit_account, sub: tx.debit_subaccount, branch: drBranch };
    if (!dr.account || !cr.account) continue; // code missing an account — skip rather than post a half entry
    gl.push({ account: dr.account, sub_account: dr.sub ?? SUB_FALLBACK, branch: dr.branch, debit_amount: value, credit_amount: null, transaction_desc: `${tx.code}` });
    gl.push({ account: cr.account, sub_account: cr.sub ?? SUB_FALLBACK, branch: cr.branch, debit_amount: null, credit_amount: value, transaction_desc: `${tx.code}` });
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
