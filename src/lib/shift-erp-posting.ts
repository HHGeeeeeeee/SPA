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

// payment / revenue / tip / settle post the code in its natural DR→CR direction;
// a refund reverses it. Net per code therefore = Σ amount with refunds negative.
const signed = (kind: string, cents: number): number => (kind === 'refund' ? -cents : cents);

/**
 * Aggregate a shift's folio lines into balanced GL lines: one DR/CR pair per
 * transaction code, netting payments/revenue/tips/settles against refunds. A
 * code whose net is negative posts with its DR/CR accounts swapped so amounts
 * stay positive. Per-line branch comes from the code's debit/credit branch,
 * falling back to the shift's branch.
 */
async function buildShiftGlLines(
  supabase: ReturnType<typeof createServiceClient>,
  shiftId: string,
  shiftBranchCode: string,
): Promise<GLLine[]> {
  const { data: lines } = await supabase
    .from('folio_lines')
    .select('amount_cents, kind, transaction_code_id, code:transaction_codes ( code, debit_account, debit_subaccount, debit_branch_id, credit_account, credit_subaccount, credit_branch_id )')
    .eq('shift_id', shiftId)
    .not('transaction_code_id', 'is', null);
  if (!lines || lines.length === 0) return [];

  // Net by code, keeping the code's GL accounts/branches alongside.
  const byCode = new Map<string, { net: number; tx: TxCodeJoin }>();
  for (const l of lines) {
    const tx = one(l.code) as TxCodeJoin | null;
    if (!tx || !l.transaction_code_id) continue;
    const cur = byCode.get(l.transaction_code_id) ?? { net: 0, tx };
    cur.net += signed(l.kind, l.amount_cents);
    byCode.set(l.transaction_code_id, cur);
  }

  // Resolve any DR/CR branch ids on the codes to Acumatica branch codes.
  const branchIds = new Set<string>();
  for (const { tx } of byCode.values()) {
    if (tx.debit_branch_id) branchIds.add(tx.debit_branch_id);
    if (tx.credit_branch_id) branchIds.add(tx.credit_branch_id);
  }
  const branchCode = new Map<string, string>();
  if (branchIds.size > 0) {
    const { data: brs } = await supabase.from('branches').select('id, code').in('id', [...branchIds]);
    for (const b of brs ?? []) branchCode.set(b.id, b.code);
  }
  const codeOfBranch = (id: string | null): string => (id ? branchCode.get(id) ?? shiftBranchCode : shiftBranchCode);

  const gl: GLLine[] = [];
  for (const { net, tx } of byCode.values()) {
    if (net === 0) continue;
    const positive = net > 0;
    const value = Math.abs(net) / 100;
    // Normal direction (net>0): DR debit account / CR credit account. Net<0
    // (refund-heavy): swap so the journal still posts positive amounts.
    const dr = positive
      ? { account: tx.debit_account, sub: tx.debit_subaccount, branch: tx.debit_branch_id }
      : { account: tx.credit_account, sub: tx.credit_subaccount, branch: tx.credit_branch_id };
    const cr = positive
      ? { account: tx.credit_account, sub: tx.credit_subaccount, branch: tx.credit_branch_id }
      : { account: tx.debit_account, sub: tx.debit_subaccount, branch: tx.debit_branch_id };
    if (!dr.account || !cr.account) continue; // code missing an account — skip rather than post a half entry
    gl.push({ account: dr.account, sub_account: dr.sub ?? SUB_FALLBACK, branch: codeOfBranch(dr.branch), debit_amount: value, credit_amount: null, transaction_desc: `${tx.code}` });
    gl.push({ account: cr.account, sub_account: cr.sub ?? SUB_FALLBACK, branch: codeOfBranch(cr.branch), debit_amount: null, credit_amount: value, transaction_desc: `${tx.code}` });
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
