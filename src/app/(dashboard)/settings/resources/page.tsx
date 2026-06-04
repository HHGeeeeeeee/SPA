import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { ResourceFormDialog, type ResourceType } from '@/components/settings/resource-form-dialog';
import { ResourcesExplorer, type ResourceRow } from '@/components/settings/resources-explorer';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [rRes, bRes, buRes] = await Promise.all([
    supabase
      .from('resources')
      .select(`
        id, branch_id, resource_type, resource_name, location_zone, capacity, business_unit_id,
        status, status_reason,
        branch:branches ( code, name )
      `)
      .order('resource_name'),
    supabase
      .from('branches')
      .select(`
        id, code, name,
        branch_business_units ( business_units ( id, code, name ) )
      `)
      .eq('active', true)
      .order('code'),
    supabase.from('business_units').select('id, code, name').order('code'),
  ]);
  if (rRes.error) throw new Error(rRes.error.message);
  if (bRes.error) throw new Error(bRes.error.message);
  if (buRes.error) throw new Error(buRes.error.message);
  const branches = (bRes.data ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    businessUnits: (b.branch_business_units ?? [])
      .map((row) => (Array.isArray(row.business_units) ? row.business_units[0] : row.business_units))
      .filter(Boolean) as { id: string; code: string; name: string }[],
  }));
  return { resources: rRes.data ?? [], branches, allBusinessUnits: buRes.data ?? [] };
}

export default async function ResourcesPage() {
  const { resources, branches, allBusinessUnits } = await fetchData();

  const rows: ResourceRow[] = resources.map((r) => {
    const branch = Array.isArray(r.branch) ? r.branch[0] : r.branch;
    return {
      id: r.id,
      branch_id: r.branch_id,
      branch_code: branch?.code ?? null,
      resource_type: r.resource_type as ResourceType,
      resource_name: r.resource_name,
      location_zone: r.location_zone,
      capacity: r.capacity,
      business_unit_id: r.business_unit_id,
      status: r.status as ResourceRow['status'],
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3" />
            Settings
          </Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Service Stations</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {resources.length} stations across {branches.length} branches
          </p>
        </div>
        <ResourceFormDialog
          branches={branches}
          allBusinessUnits={allBusinessUnits}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Station
            </Button>
          }
        />
      </div>

      <ResourcesExplorer rows={rows} branches={branches} allBusinessUnits={allBusinessUnits} />
    </div>
  );
}
