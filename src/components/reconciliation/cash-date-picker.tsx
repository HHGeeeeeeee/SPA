'use client';

import { useRouter } from 'next/navigation';

// Date picker for Cash Reconciliation — navigates as soon as the date changes
// (no Enter needed). The page is per-day, so this just swaps the ?date param.
export function CashDatePicker({ branchId, date }: { branchId?: string; date: string }) {
  const router = useRouter();
  return (
    <input
      type="date"
      value={date}
      onChange={(e) => {
        if (e.target.value) router.push(`/reconciliation/cash?branch=${branchId ?? ''}&date=${e.target.value}`);
      }}
      className="rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm"
    />
  );
}
