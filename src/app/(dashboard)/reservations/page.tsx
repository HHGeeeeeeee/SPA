import { Plus, CalendarDays } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { NewReservationDialog } from '@/components/reservations/new-reservation-dialog';
import { ReservationRowActions } from '@/components/reservations/reservation-row-actions';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  reserved: 'secondary',
  confirmed: 'default',
  converted: 'default',
  cancelled: 'destructive',
  no_show: 'destructive',
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function fetchData() {
  const supabase = createServiceClient();
  const [resv, br, src, cat] = await Promise.all([
    supabase
      .from('reservations')
      .select(`
        id, reservation_no, guest_name, guest_phone, pax, status,
        desired_service_start, desired_service_end,
        branch:branches ( code ),
        source:customer_sources ( code ),
        category:service_categories ( code, name )
      `)
      .is('deleted_at', null)
      .order('desired_service_start', { ascending: false })
      .limit(200),
    supabase.from('branches').select('id, code, name, branch_business_units ( business_unit_id )').eq('active', true).eq('reservation_enabled', true).order('code'),
    supabase.from('customer_sources').select('id, code, name, phone_required').eq('active', true).order('code'),
    supabase.from('service_categories').select('id, code, name, service_category_business_units ( business_unit_id )').eq('active', true).order('code'),
  ]);
  if (resv.error) throw new Error(resv.error.message);
  if (br.error) throw new Error(br.error.message);
  if (src.error) throw new Error(src.error.message);
  if (cat.error) throw new Error(cat.error.message);
  const branches = (br.data ?? []).map((b) => ({
    id: b.id, code: b.code, name: b.name,
    businessUnitIds: (b.branch_business_units ?? []).map((x) => x.business_unit_id),
  }));
  const serviceCategories = (cat.data ?? []).map((c) => ({
    id: c.id, code: c.code, name: c.name,
    businessUnitIds: (c.service_category_business_units ?? []).map((x) => x.business_unit_id),
  }));
  return { reservations: resv.data ?? [], branches, sources: src.data ?? [], serviceCategories };
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function ReservationsPage() {
  const { reservations, branches, sources, serviceCategories } = await fetchData();
  const upcoming = reservations.filter((r) => ['reserved', 'confirmed'].includes(r.status)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reservations</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {reservations.length} shown · {upcoming} active
          </p>
        </div>
        <NewReservationDialog
          branches={branches}
          sources={sources}
          serviceCategories={serviceCategories}
          trigger={
            <Button disabled={branches.length === 0}>
              <Plus className="size-4" />
              New Reservation
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Reservation No</TableHead>
              <TableHead className="w-20 font-bold">Branch</TableHead>
              <TableHead className="font-bold">Guest</TableHead>
              <TableHead className="font-bold">Service</TableHead>
              <TableHead className="font-bold">Source</TableHead>
              <TableHead className="w-14 font-bold">PAX</TableHead>
              <TableHead className="font-bold">Desired Time</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reservations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-16">
                  <CalendarDays className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">
                    No reservations yet. Click &ldquo;New Reservation&rdquo; to book one.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              reservations.map((r) => {
                const branch = one(r.branch);
                const source = one(r.source);
                const category = one(r.category);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-bold">{r.reservation_no}</TableCell>
                    <TableCell className="font-mono font-bold">{branch?.code ?? '—'}</TableCell>
                    <TableCell className="font-semibold">
                      {r.guest_name}
                      {r.guest_phone && <span className="ml-2 font-medium text-muted-foreground">{r.guest_phone}</span>}
                    </TableCell>
                    <TableCell className="font-medium">{category?.name ?? '—'}</TableCell>
                    <TableCell className="font-mono font-semibold text-sm">{source?.code ?? '—'}</TableCell>
                    <TableCell className="font-bold tabular">{r.pax}</TableCell>
                    <TableCell className="font-medium tabular text-sm">
                      {fmt(r.desired_service_start)} – {new Date(r.desired_service_end).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'} className="font-bold capitalize">
                        {r.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ReservationRowActions reservation={{ id: r.id, status: r.status }} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
