'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, ExternalLink, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { loadSoaPayments, getArProofUrl, type SoaPaymentRow } from '@/app/(dashboard)/reconciliation/soa/actions';

function peso(c: number): string {
  return `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function fmt(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// Per-payment ledger for a SOA: date, method, amount, ref, proof (signed URL),
// and the ERP outcome (GL batch number on success, red "Failed" with the error
// in a tooltip on failure). A statement can have several partials, each its own
// posting.
export function SoaPaymentsList({ soaId }: { soaId: string }) {
  const [rows, setRows] = useState<SoaPaymentRow[] | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancel = false;
    loadSoaPayments(soaId).then((d) => { if (!cancel) setRows(d); });
    return () => { cancel = true; };
  }, [soaId]);

  function viewProof(path: string) {
    start(async () => {
      const r = await getArProofUrl(path);
      if (r.ok) window.open(r.data!.url, '_blank', 'noopener');
      else toast.error(r.error);
    });
  }

  if (rows === null) {
    return <p className="text-xs font-medium text-muted-foreground py-2">Loading payments…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-xs font-medium text-muted-foreground py-2">No payments recorded yet.</p>;
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
            <th className="px-2 py-1.5 font-bold">ERP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="px-2 py-1.5 tabular">{fmt(p.paid_at)}</td>
              <td className="px-2 py-1.5 capitalize">{p.payment_method ?? '—'}</td>
              <td className="px-2 py-1.5 tabular text-right font-bold">{peso(p.amount_cents)}</td>
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
              <td className="px-2 py-1.5">
                {p.gl_batch_nbr ? (
                  <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-bold text-primary">
                    <Check className="size-3" /> GL #{p.gl_batch_nbr}
                  </span>
                ) : p.posting_status === 'failed' ? (
                  <span
                    title={p.posting_error ?? 'ERP posting failed'}
                    className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 font-bold text-destructive"
                  >
                    <TriangleAlert className="size-3" /> Failed
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
