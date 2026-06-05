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

// The order's service location — on-site (in-house stations) vs Dispatch (sent
// to a hotel; no in-house station, occupies a therapist's time). Lives in the
// "Type" slot of the Order Details header. When Dispatch, a Hotel picker shows
// next to it. Saves on change.
const LOCATION_OPTS = [
  { value: 'on_site', label: 'On-site' },
  { value: 'external_hotel', label: 'Dispatch' },
];
const NONE = '__none__';

interface HotelOpt { id: string; name: string }

export function OrderLocationEditor({
  orderId,
  current,
  currentHotelId,
  hotels,
  editable,
}: {
  orderId: string;
  current: string | null;
  currentHotelId: string | null;
  hotels: HotelOpt[];
  editable: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? 'on_site');
  const [hotelId, setHotelId] = useState(currentHotelId ?? NONE);
  const [pending, start] = useTransition();

  const typeLabel = (v: string) => LOCATION_OPTS.find((o) => o.value === v)?.label ?? 'On-site';
  const hotelName = (id: string | null) => hotels.find((h) => h.id === id)?.name ?? '—';
  const isDispatch = value === 'external_hotel';

  if (!editable) {
    return (
      <div>
        <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</dt>
        <dd className="font-semibold mt-0.5">
          {typeLabel(current ?? 'on_site')}
          {current === 'external_hotel' && <span className="text-muted-foreground"> · {hotelName(currentHotelId)}</span>}
        </dd>
      </div>
    );
  }

  function persist(type: string, hotel: string) {
    start(async () => {
      const r = await updateOrderLocationType({
        order_id: orderId,
        service_location_type: type,
        external_hotel_id: hotel === NONE ? null : hotel,
      });
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  }

  function pickType(v: string) {
    if (!v) return;
    setValue(v);
    if (v === 'on_site') { setHotelId(NONE); persist(v, NONE); }
    else persist(v, hotelId);
  }
  function pickHotel(v: string) {
    if (!v) return;
    setHotelId(v);
    persist(value, v);
  }

  const hotelOptions = [{ value: NONE, label: 'No hotel' }, ...hotels.map((h) => ({ value: h.id, label: h.name }))];

  return (
    <>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</dt>
        <dd className="mt-0.5">
          <Select items={LOCATION_OPTS} value={value} onValueChange={(v) => pickType(v as string)} disabled={pending}>
            <SelectTrigger className="h-8 w-36 font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOCATION_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </dd>
      </div>
      {isDispatch && (
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hotel</dt>
          <dd className="mt-0.5">
            <Select items={hotelOptions} value={hotelId} onValueChange={(v) => pickHotel(v as string)} disabled={pending}>
              <SelectTrigger className="h-8 w-44 font-semibold"><SelectValue /></SelectTrigger>
              <SelectContent>
                {hotelOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </dd>
        </div>
      )}
    </>
  );
}
