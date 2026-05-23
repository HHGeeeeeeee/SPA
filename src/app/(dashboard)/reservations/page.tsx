import { Plus, Footprints } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { NewReservationDialog } from '@/components/reservations/new-reservation-dialog';
import { ReservationsExplorer, type ReservationRow } from '@/components/reservations/reservations-explorer';
import { cancelStaleReservations, getReservationGraceMinutes, isReservationOverdue } from '@/lib/reservations';

export const dynamic = 'force-dynamic';

function phtDate(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchData() {
  const supabase = createServiceClient();
  await cancelStaleReservations(); // sweep past-day no-shows → cancelled
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
      .limit(500),
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

  const graceMin = await getReservationGraceMinutes();
  const rows: ReservationRow[] = (resv.data ?? []).map((r) => {
    const cats = (r.reservation_service_categories ?? [])
      .map((link) => one(link.service_categories))
      .filter(Boolean) as { id: string; code: string; name: string }[];
    const pinnedIds = (r.reservation_resources ?? []).map((x) => x.resource_id);
    const pinnedNames = (r.reservation_resources ?? [])
      .map((x) => one(x.resources)?.resource_name)
      .filter(Boolean) as string[];
    return {
      id: r.id,
      reservation_no: r.reservation_no,
      branch_code: one(r.branch)?.code ?? '—',
      guest_name: r.guest_name,
      guest_phone: r.guest_phone,
      service_names: cats.map((c) => c.name),
      pinned_names: pinnedNames,
      source_code: one(r.source)?.code ?? null,
      pax: r.pax,
      status: r.status,
      overdue: isReservationOverdue({ status: r.status, desiredStartIso: r.desired_service_start, graceMin }),
      desired_service_start: r.desired_service_start,
      desired_service_end: r.desired_service_end,
      service_date: phtDate(r.desired_service_start),
      edit: {
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
      },
    };
  });

  return { rows, branches, sources: src.data ?? [], serviceCategories };
}

export default async function ReservationsPage() {
  const { rows, branches, sources, serviceCategories } = await fetchData();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reservations</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {rows.length} loaded · filter below
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NewReservationDialog
            branches={branches}
            sources={sources}
            serviceCategories={serviceCategories}
            walkIn
            trigger={
              <Button
                disabled={branches.length === 0}
                className="bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/40 dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                <Footprints className="size-4" />
                Walk-in
              </Button>
            }
          />
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
      </div>

      <ReservationsExplorer
        rows={rows}
        branches={branches}
        sources={sources}
        serviceCategories={serviceCategories}
      />
    </div>
  );
}
