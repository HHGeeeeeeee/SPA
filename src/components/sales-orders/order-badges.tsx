'use client';

import type { ReactNode } from 'react';
import { Check, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

// Service / fulfillment axis — the label for the lifecycle status. `completed`
// reads as "Service done" with the separate payment badge showing the balance;
// `closed` means service done AND paid in full.
export const SERVICE_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  in_service: 'In service',
  completed: 'Service done',
  closed: 'Closed',
  void: 'Cancelled',
  posting: 'Posting',
  reserved: 'Reserved',
};

const STAGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  reserved: 'secondary', draft: 'secondary', open: 'default', in_service: 'default',
  completed: 'default', posting: 'secondary', closed: 'secondary', void: 'destructive',
};

// Plain-language note shown on hover so staff know exactly what a stage means.
const STAGE_DESC: Record<string, string> = {
  draft: 'Counter draft — not confirmed; no resources held yet.',
  open: 'Confirmed and resources are held; service has not started.',
  in_service: 'Service is in progress — revenue is booked.',
  completed: 'Service finished but not yet paid in full — check the payment badge for the balance due.',
  closed: 'Service finished and paid in full — the order is done.',
  void: 'Cancelled — all scheduled services cancelled, excluded from totals.',
  posting: 'Posting to the ledger…',
  reserved: 'Reservation.',
};

export type PayState = 'ar' | 'none' | 'paid' | 'partial' | 'unpaid';

const PAY_DESC: Record<PayState, string> = {
  ar: 'Billed to an AR account — settled monthly on the Revenue SOA, not at the counter.',
  none: 'No charge on this order.',
  paid: 'Paid in full.',
  partial: 'Partly paid — a balance is still due at the counter.',
  unpaid: 'No payment collected yet.',
};

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

// Payment state from amounts alone — the single source of truth shared by the
// badge and the list's Payment filter. `partial`/`unpaid` both mean "owing".
export function orderPaymentState(o: { total_cents: number; paid_cents: number; is_ar: boolean }): PayState {
  if (o.is_ar) return 'ar';
  if (o.total_cents === 0) return 'none';
  if (o.paid_cents >= o.total_cents) return 'paid';
  return o.paid_cents > 0 ? 'partial' : 'unpaid';
}

const BASE = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap';

// Service/lifecycle badge with a hover note explaining the stage.
export function ServiceBadge({ status }: { status: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge variant={STAGE_VARIANT[status] ?? 'secondary'} className="cursor-default font-bold">
              {SERVICE_LABEL[status] ?? status.replace('_', ' ')}
            </Badge>
          }
        />
        <TooltipContent side="bottom">{STAGE_DESC[status] ?? ''}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Payment axis — derived purely from amounts (no stored field), kept separate
// from the service/lifecycle status. A completed (service-done) order that still
// owes is the dangerous "looks done but unpaid" case → loud red; the same
// shortfall before service is finished is expected, so it stays calm. Hover for
// a plain-language note.
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
  // A draft is the cashier still composing the order — no payment is expected
  // yet, so the "Unpaid" badge would be alarming + meaningless. Stay quiet
  // until the order is at least open / in_service / completed.
  if (status === 'draft') return null;
  const state = orderPaymentState({ total_cents, paid_cents, is_ar });
  const due = total_cents - paid_cents;

  let cls = `${BASE} bg-muted text-muted-foreground`;
  let label: ReactNode = 'Unpaid';
  if (state === 'ar') {
    label = 'AR · billed';
  } else if (state === 'none') {
    label = 'No charge';
  } else if (state === 'paid') {
    cls = `${BASE} bg-primary/15 text-primary`;
    label = <><Check className="size-3" /> Paid</>;
  } else if (status === 'completed') {
    // Service done but money not (fully) in — the trap. Full payment would have
    // advanced it to Closed, so a completed counter order is by definition owing.
    cls = `${BASE} bg-destructive/10 text-destructive`;
    label = <><TriangleAlert className="size-3" /> {state === 'partial' ? 'Partial' : 'Unpaid'} · {peso(due)} due</>;
  } else if (state === 'partial') {
    cls = `${BASE} bg-amber-100 text-amber-800`;
    label = `Partial · ${peso(due)} due`;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span className={`${cls} cursor-default`}>{label}</span>} />
        <TooltipContent side="bottom">{PAY_DESC[state]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
