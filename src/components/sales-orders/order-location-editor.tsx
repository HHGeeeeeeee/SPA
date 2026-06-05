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
import { updateOrderLocationType } from '@/app/(dashboard)/sales-orders/actions';

// The order's service location — on-site (in-house stations) vs Dispatch
// (sent to a hotel; no in-house station, occupies a therapist's time). Lives in
// the "Type" slot of the Order Details header. Saves on change.
const LOCATION_OPTS = [
  { value: 'on_site', label: 'On-site' },
  { value: 'external_hotel', label: 'Dispatch' },
];

export function OrderLocationEditor({
  orderId,
  current,
  editable,
}: {
  orderId: string;
  current: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? 'on_site');
  const [pending, start] = useTransition();

  const labelFor = (v: string) => LOCATION_OPTS.find((o) => o.value === v)?.label ?? 'On-site';

  if (!editable) {
    return (
      <div>
        <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</dt>
        <dd className="font-semibold mt-0.5">{labelFor(current ?? 'on_site')}</dd>
      </div>
    );
  }

  function pick(v: string) {
    if (!v) return;
    setValue(v);
    start(async () => {
      const r = await updateOrderLocationType({ order_id: orderId, service_location_type: v });
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  }

  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</dt>
      <dd className="mt-0.5">
        <Select items={LOCATION_OPTS} value={value} onValueChange={(v) => pick(v as string)} disabled={pending}>
          <SelectTrigger className="h-8 w-36 font-semibold"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LOCATION_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </dd>
    </div>
  );
}
