'use client';

import { useRouter } from 'next/navigation';

import { TopBarPortal } from '@/components/layout/topbar-portal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Branch switcher hoisted into the global top bar (top-right), matching the
// Calendar / Shift Schedule pattern instead of an inline row of pills.
export function RemittanceBranchPicker({
  branches,
  branchId,
  date,
}: {
  branches: { id: string; code: string; name: string }[];
  branchId: string;
  date: string;
}) {
  const router = useRouter();
  const options = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  return (
    <TopBarPortal>
      <Select
        items={options}
        value={branchId}
        onValueChange={(v) => v && router.push(`/reconciliation/shift-remittance?branch=${v}&date=${date}`)}
      >
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </TopBarPortal>
  );
}
