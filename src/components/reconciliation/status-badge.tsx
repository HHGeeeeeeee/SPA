'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

/**
 * Shared status badge for reconciliation pages. Wraps the visual `Badge` in a
 * Tooltip so hovering any recon status (SOA / Tip / Commission / AR) explains
 * what that state means + what action a manager can still take. One dictionary
 * keeps wording consistent across the whole recon area — when a new status is
 * added, define it here once and every list picks it up.
 *
 * Kinds keep the same status code (e.g. "closed") meaning different things in
 * different modules (Tip "closed" = AP posted; Commission "closed" = period
 * handed to HR), so the lookup is `(kind, status)`.
 */

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';
type Info = { variant: Variant; desc: string };

const STATUS_INFO: Record<string, Record<string, Info>> = {
  soa: {
    issued: {
      variant: 'default',
      desc: 'Statement issued — awaiting payment (third-party) or intercompany settle. Counts as open AR.',
    },
    partial_paid: {
      variant: 'secondary',
      desc: 'Some payments received; outstanding balance still open. Record more payments until fully cleared.',
    },
    settled: {
      variant: 'default',
      desc: 'Fully cleared — third-party paid in full, or intercompany cost-transferred. ERP voucher attached.',
    },
    void: {
      variant: 'destructive',
      desc: 'Voided — orders released back to Generate for a new statement. Excluded from totals.',
    },
  },
  tip: {
    draft: {
      variant: 'secondary',
      desc: 'Open settlement, not yet posted to Acumatica AP. Tips selected but no AP Bill exists.',
    },
    posting: {
      variant: 'secondary',
      desc: 'Mid-post — AP Bill creation in flight to Acumatica. Will flip to Closed (success) or Failed.',
    },
    closed: {
      variant: 'default',
      desc: 'AP Bill posted to Acumatica; tips will be paid out per the AP cycle.',
    },
    failed: {
      variant: 'destructive',
      desc: 'AP posting failed — settlement intact, Retry available to re-post without re-picking tips.',
    },
    void: {
      variant: 'destructive',
      desc: 'Voided — tips returned to the open pool; any ERP AP Bill must be reversed manually in Acumatica.',
    },
  },
  commission: {
    draft: {
      variant: 'secondary',
      desc: 'Open commission period — computed for review; not yet handed to HR.',
    },
    closed: {
      variant: 'default',
      desc: 'Period closed; commission entries finalised for HR payroll. Not posted to ERP (HR-only).',
    },
    void: {
      variant: 'destructive',
      desc: 'Voided — commission entries returned to the open pool for re-settlement.',
    },
  },
};

// Visual label — replaces underscores with spaces and keeps the original code
// in lowercase so the Badge's `capitalize` class formats it (e.g. "Partial Paid").
function label(status: string): string {
  return status.replace(/_/g, ' ');
}

export function StatusBadge({
  status,
  kind,
  className = '',
}: {
  status: string;
  kind: keyof typeof STATUS_INFO;
  className?: string;
}) {
  const info = STATUS_INFO[kind]?.[status];
  // Fallback when a brand-new status hits production before the dictionary is
  // updated: still render the visual badge (secondary) so nothing looks broken,
  // but the tooltip nudges the dev to fill in a description.
  const variant = info?.variant ?? 'secondary';
  const desc = info?.desc ?? `Status: ${label(status)} (no description yet).`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge variant={variant} className={`cursor-default font-bold capitalize ${className}`}>
              {label(status)}
            </Badge>
          }
        />
        <TooltipContent side="bottom">{desc}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
