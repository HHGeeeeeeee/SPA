import { Check, TriangleAlert } from 'lucide-react';

// Service / fulfillment axis — the label for the lifecycle status. `completed`
// and `paid` are both "service done"; the separate payment badge tells them
// apart, so a green "Service done" can't be misread as "paid".
export const SERVICE_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  in_service: 'In service',
  completed: 'Service done',
  paid: 'Service done',
  closed: 'Closed',
  void: 'Void',
  posting: 'Posting',
  reserved: 'Reserved',
};

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export type PayState = 'ar' | 'none' | 'paid' | 'partial' | 'unpaid';

// Payment state from amounts alone — the single source of truth shared by the
// badge and the list's Payment filter. `partial`/`unpaid` both mean "owing".
export function orderPaymentState(o: { total_cents: number; paid_cents: number; is_ar: boolean }): PayState {
  if (o.is_ar) return 'ar';
  if (o.total_cents === 0) return 'none';
  if (o.paid_cents >= o.total_cents) return 'paid';
  return o.paid_cents > 0 ? 'partial' : 'unpaid';
}

const BASE = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap';

// Payment axis — derived purely from amounts (no stored field), kept separate
// from the service/lifecycle status. A completed (service-done) order that still
// owes is the dangerous "looks done but unpaid" case → loud red; the same
// shortfall before service is finished is expected, so it stays calm.
export function PaymentBadge({
  total_cents,
  paid_cents,
  is_ar,
  status,
}: {
  total_cents: number;
  paid_cents: number;
  is_ar: boolean;
  status: string;
}) {
  if (status === 'void') return null;
  const state = orderPaymentState({ total_cents, paid_cents, is_ar });
  if (state === 'ar') return <span className={`${BASE} bg-muted text-muted-foreground`}>AR · billed</span>;
  if (state === 'none') return <span className={`${BASE} bg-muted text-muted-foreground`}>No charge</span>;
  if (state === 'paid') {
    return <span className={`${BASE} bg-primary/15 text-primary`}><Check className="size-3" /> Paid</span>;
  }

  const due = total_cents - paid_cents;
  const partial = state === 'partial';
  // Service finished but money not (fully) in — the trap. Full payment would have
  // advanced it to Paid, so a completed counter order is by definition owing.
  if (status === 'completed') {
    return (
      <span className={`${BASE} bg-destructive/10 text-destructive`}>
        <TriangleAlert className="size-3" /> {partial ? 'Partial' : 'Unpaid'} · {peso(due)} due
      </span>
    );
  }
  return partial
    ? <span className={`${BASE} bg-amber-100 text-amber-800`}>Partial · {peso(due)} due</span>
    : <span className={`${BASE} bg-muted text-muted-foreground`}>Unpaid</span>;
}
