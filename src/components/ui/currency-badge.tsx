import { cn } from '@/lib/utils';

/**
 * Currency context indicator. The POS surfaces no per-amount currency
 * symbol (₱) on the grid — this small badge in each page's title bar tells
 * the reader the unit once, and every "1,500" / "₱ 1,500.00" downstream
 * means the same thing.
 *
 * Default reads "Currency · PHP". `compact` drops the label for very tight
 * places (e.g. dialog headers).
 */
export function CurrencyBadge({
  code = 'PHP',
  compact = false,
  className,
}: {
  code?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground shrink-0',
        className,
      )}
      title={`All amounts shown in ${code}`}
    >
      {!compact && <span className="text-muted-foreground/70">Currency</span>}
      {!compact && <span className="text-muted-foreground/40">·</span>}
      <span className="text-foreground/80">{code}</span>
    </span>
  );
}
