'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateOrderBranchUnit } from '@/app/(dashboard)/sales-orders/actions';

interface BranchOpt { id: string; name: string; businessUnits: { id: string; name: string }[] }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/**
 * Inline Branch / Business Unit editor for the order detail panel (the New Order
 * dialog is gone, so these live here). Branch is locked once the order has any
 * services — changing it would orphan branch-scoped therapist/station/pricing.
 * Business Unit defaults to SPA and is a plain label when the branch has one.
 */
export function OrderBranchUnitEditor({
  orderId,
  branches,
  currentBranchId,
  currentBusinessUnitId,
  hasItems,
  editable,
}: {
  orderId: string;
  branches: BranchOpt[];
  currentBranchId: string;
  currentBusinessUnitId: string | null;
  hasItems: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(currentBranchId);
  const [unitId, setUnitId] = useState(currentBusinessUnitId ?? '');
  const [pending, start] = useTransition();

  const branch = branches.find((b) => b.id === branchId);
  const units = branch?.businessUnits ?? [];
  const unitName = units.find((u) => u.id === unitId)?.name ?? '—';

  if (!editable) {
    return (
      <>
        <Field label="Branch"><span className="font-semibold">{branch?.name ?? '—'}</span></Field>
        <Field label="Business Unit"><span className="font-semibold">{unitName}</span></Field>
      </>
    );
  }

  function persist(next: { branch_id?: string; business_unit_id?: string | null }, revert: () => void) {
    start(async () => {
      const r = await updateOrderBranchUnit({ order_id: orderId, ...next });
      if (r.ok) router.refresh();
      else { toast.error(r.error); revert(); }
    });
  }

  function pickBranch(v: string) {
    if (!v || v === branchId) return;
    const prev = branchId;
    setBranchId(v);
    setUnitId(branches.find((b) => b.id === v)?.businessUnits[0]?.id ?? '');
    persist({ branch_id: v }, () => { setBranchId(prev); setUnitId(currentBusinessUnitId ?? ''); });
  }
  function pickUnit(v: string) {
    if (!v || v === unitId) return;
    const prev = unitId;
    setUnitId(v);
    persist({ business_unit_id: v }, () => setUnitId(prev));
  }

  return (
    <>
      <Field label="Branch">
        {hasItems ? (
          <span className="font-semibold">{branch?.name ?? '—'} <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">locked</span></span>
        ) : (
          <Select items={branches.map((b) => ({ value: b.id, label: b.name }))} value={branchId} onValueChange={(v) => pickBranch(v as string)} disabled={pending}>
            <SelectTrigger className="h-8 w-40 font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Business Unit">
        {units.length > 1 ? (
          <Select items={units.map((u) => ({ value: u.id, label: u.name }))} value={unitId} onValueChange={(v) => pickUnit(v as string)} disabled={pending}>
            <SelectTrigger className="h-8 w-36 font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-semibold">{unitName}</span>
        )}
      </Field>
    </>
  );
}
