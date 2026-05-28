'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Date-range filter for the Revenue Confirm History tab. Drives the page via
 * URL search params (`hist_from`, `hist_to`) so the server-side page re-loads
 * with the narrowed query — no extra client-side filtering needed.
 */
export function RevenueHistoryFilter({
  from,
  to,
  shownCount,
  totalCount,
}: {
  from: string;
  to: string;
  shownCount: number;
  totalCount: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(next: { from?: string; to?: string }) {
    const sp = new URLSearchParams(params.toString());
    if (next.from === '' || next.from === undefined) sp.delete('hist_from');
    if (next.from && next.from.length) sp.set('hist_from', next.from);
    if (next.to === '' || next.to === undefined) sp.delete('hist_to');
    if (next.to && next.to.length) sp.set('hist_to', next.to);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const hasFilter = !!(from || to);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Date From</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => go({ from: e.target.value, to })}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-semibold">Date To</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => go({ from, to: e.target.value })}
            className="w-40"
          />
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={() => go({ from: '', to: '' })}
            className="self-end mb-2 text-xs font-semibold text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto self-end mb-2 text-xs font-semibold text-muted-foreground">
          {totalCount != null && totalCount !== shownCount
            ? `${shownCount} of ${totalCount}`
            : `${shownCount} order${shownCount === 1 ? '' : 's'}`}
        </span>
      </div>
    </Card>
  );
}
