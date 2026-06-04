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
import { updateOrderSourceBilling } from '@/app/(dashboard)/sales-orders/actions';

const NONE = '__none__';

interface SourceOpt { id: string; code: string; name: string; default_billing_to_id: string | null }
interface BillingOpt { id: string; code: string; name: string }

function Static({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="font-semibold mt-0.5">{value}</dd>
    </div>
  );
}

/**
 * Inline Customer Source / Billing To editor for the order detail panel.
 * Billing follows the source: a source with a default billing destination locks
 * Billing to it (same rule as the New Order dialog). Saves on change. When the
 * order is no longer editable it renders the values as plain text.
 */
export function OrderSourceBillingEditor({
  orderId,
  sources,
  billingDestinations,
  currentSourceId,
  currentBillingId,
  editable,
}: {
  orderId: string;
  sources: SourceOpt[];
  billingDestinations: BillingOpt[];
  currentSourceId: string | null;
  currentBillingId: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(currentSourceId ?? NONE);
  const [billingId, setBillingId] = useState(currentBillingId ?? NONE);
  const [pending, start] = useTransition();

  if (!editable) {
    const sName = sources.find((s) => s.id === currentSourceId)?.name ?? '—';
    const bName = billingDestinations.find((b) => b.id === currentBillingId)?.name ?? 'Self-pay';
    return (<><Static label="Customer Source" value={sName} /><Static label="Billing To" value={bName} /></>);
  }

  const selectedSource = sources.find((s) => s.id === sourceId);
  const billingLocked = !!selectedSource?.default_billing_to_id;
  const sourceOptions = [{ value: NONE, label: 'None' }, ...sources.map((s) => ({ value: s.id, label: s.name }))];
  const billingOptions = [{ value: NONE, label: 'Self-pay' }, ...billingDestinations.map((b) => ({ value: b.id, label: b.name }))];

  function persist(nextSource: string, nextBilling: string) {
    start(async () => {
      const r = await updateOrderSourceBilling({
        order_id: orderId,
        source_id: nextSource === NONE ? null : nextSource,
        billing_to_id: nextBilling === NONE ? null : nextBilling,
      });
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  }

  function pickSource(v: string) {
    if (!v) return;
    const src = sources.find((s) => s.id === v);
    const nextBilling = src?.default_billing_to_id ?? (billingId === NONE ? NONE : billingId);
    setSourceId(v);
    setBillingId(nextBilling);
    persist(v, nextBilling);
  }

  function pickBilling(v: string) {
    if (!v) return;
    setBillingId(v);
    persist(sourceId, v);
  }

  return (
    <>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Customer Source</dt>
        <dd className="mt-0.5">
          <Select items={sourceOptions} value={sourceId} onValueChange={(v) => pickSource(v as string)} disabled={pending}>
            <SelectTrigger className="h-8 w-44 font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sourceOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Billing To</dt>
        <dd className="mt-0.5">
          <Select items={billingOptions} value={billingId} onValueChange={(v) => pickBilling(v as string)} disabled={pending || billingLocked}>
            <SelectTrigger className="h-8 w-44 font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {billingOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {billingLocked && <p className="text-[11px] font-medium text-muted-foreground mt-1">Set by source</p>}
        </dd>
      </div>
    </>
  );
}
