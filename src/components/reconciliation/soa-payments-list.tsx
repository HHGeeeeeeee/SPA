'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { loadSoaPayments, getArProofUrl, type SoaPaymentRow } from '@/app/(dashboard)/reconciliation/soa/actions';

function peso(c: number): string {
  return (c / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function fmt(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// Settle ledger for a SOA: each settle (and any reversal) is a folio line —
// date, method, amount (reversals shown negative), reference, and the proof
// (signed URL). ERP is derived later from Sales Remittance, so there's no
// per-line posting status here anymore.
export function SoaPaymentsList({ soaId }: { soaId: string }) {
  const [rows, setRows] = useState<SoaPaymentRow[] | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(() => {
    let cancel = false;
    loadSoaPayments(soaId).then((d) => { if (!cancel) setRows(d); });
    return () => { cancel = true; };
  }, [soaId]);

  useEffect(() => refresh(), [refresh]);

  function viewProof(path: string) {
    start(async () => {
      const r = await getArProofUrl(path);
      if (r.ok) window.open(r.data!.url, '_blank', 'noopener');
      else toast.error(r.error);
    });
  }

  if (rows === null) {
    return <p className="text-xs font-medium text-muted-foreground py-2">Loading settlements…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-xs font-medium text-muted-foreground py-2">Not settled yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-2 py-1.5 font-bold">Date</th>
            <th className="px-2 py-1.5 font-bold">Method</th>
            <th className="px-2 py-1.5 font-bold text-right">Amount</th>
            <th className="px-2 py-1.5 font-bold">Reference</th>
            <th className="px-2 py-1.5 font-bold">Proof</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const reversal = p.kind === 'refund';
            return (
              <tr key={p.id} className="border-t border-border">
                <td className="px-2 py-1.5 tabular">{fmt(p.paid_at)}</td>
                <td className="px-2 py-1.5 capitalize">{p.payment_method ?? '—'}{reversal ? ' · reversal' : ''}</td>
                <td className={`px-2 py-1.5 tabular text-right font-bold ${reversal ? 'text-destructive' : ''}`}>{reversal ? '−' : ''}{peso(p.amount_cents)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{p.reference_no ?? '—'}</td>
                <td className="px-2 py-1.5">
                  {p.proof_file_path ? (
                    <button
                      type="button"
                      onClick={() => viewProof(p.proof_file_path!)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 font-bold text-primary hover:underline disabled:opacity-50"
                    >
                      View <ExternalLink className="size-3" />
                    </button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
