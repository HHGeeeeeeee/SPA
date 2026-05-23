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
        branch_id, source_id, gender_preference, service_location_type, note, seat_together,
        branch:branches ( code ),
        source:customer_sources ( code ),
        reservation_service_categories ( service_categories ( id, code, name ) ),
        reservation_resources ( resource_id, resources ( resource_name ) )
      `)
      .is('deleted_at', null)
      .order('desired_service_start', { ascending: false })
      .limit(200),
    supabase.from('branches').select('id, code, name, branch_business_units ( business_unit_id )').eq('active', true).eq('reservation_enabled', true).order('code'),
    supabase.from('customer_sources').select('id, code, name, phone_required').eq('active', true).order('code'),
    supabase.from('service_categories').select('id, code, name, required_resource_type, service_category_business_units ( business_unit_id )').eq('active', true).order('code'),
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
    requiredResourceType: c.required_resource_type,
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
              <TableHead className="w-[190px] font-bold whitespace-nowrap">Reservation No</TableHead>
              <TableHead className="w-16 font-bold">Branch</TableHead>
              <TableHead className="w-44 font-bold">Guest</TableHead>
              <TableHead className="min-w-[260px] font-bold">Service</TableHead>
              <TableHead className="w-24 font-bold">Source</TableHead>
              <TableHead className="w-14 font-bold">PAX</TableHead>
              <TableHead className="w-[200px] font-bold whitespace-nowrap">Desired Time</TableHead>
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
                const cats = (r.reservation_service_categories ?? [])
                  .map((link) => one(link.service_categories))
                  .filter(Boolean) as { id: string; code: string; name: string }[];
                // Beds are staff-internal: shown here in the back office, but the
                // booker never gets to pick them (booking form only offers
                // "seat together"; bed selection is behind "Adjust beds (staff)").
                const pinnedIds = (r.reservation_resources ?? []).map((x) => x.resource_id);
                const pinnedNames = (r.reservation_resources ?? [])
                  .map((x) => one(x.resources)?.resource_name)
                  .filter(Boolean) as string[];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-bold whitespace-nowrap">{r.reservation_no}</TableCell>
                    <TableCell className="font-mono font-bold">{branch?.code ?? '—'}</TableCell>
                    <TableCell className="font-semibold">
                      <div>{r.guest_name}</div>
                      {r.guest_phone && <div className="font-medium text-muted-foreground text-xs tabular">{r.guest_phone}</div>}
                    </TableCell>
                    <TableCell className="font-medium">
                      {cats.length ? cats.map((c) => c.name).join(', ') : '—'}
                      {pinnedNames.length > 0 && (
                        <span className="ml-2 inline-flex items-center rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                          🛏 {pinnedNames.join(', ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-sm">{source?.code ?? '—'}</TableCell>
                    <TableCell className="font-bold tabular">{r.pax}</TableCell>
                    <TableCell className="font-medium tabular text-sm whitespace-nowrap">
                      {fmt(r.desired_service_start)} – {new Date(r.desired_service_end).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'} className="font-bold capitalize">
                        {r.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ReservationRowActions
                        reservation={{
                          id: r.id,
                          status: r.status,
                          branch_id: r.branch_id,
                          source_id: r.source_id,
                          service_category_ids: cats.map((c) => c.id),
                          guest_name: r.guest_name,
                          guest_phone: r.guest_phone,
                          pax: r.pax,
                          gender_preference: r.gender_preference,
                          service_location_type: r.service_location_type,
                          note: r.note,
                          desired_service_start: r.desired_service_start,
                          desired_service_end: r.desired_service_end,
                          resource_ids: pinnedIds,
                          seat_together: r.seat_together,
                        }}
                        branches={branches}
                        sources={sources}
                        serviceCategories={serviceCategories}
                      />
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
