import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';

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
import { ResourceFormDialog, type ResourceItem, type ResourceType } from '@/components/settings/resource-form-dialog';
import { ResourceRowActions } from '@/components/settings/resource-row-actions';

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
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
    supabase.from('business_units').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (rRes.error) throw new Error(rRes.error.message);
  if (bRes.error) throw new Error(bRes.error.message);
  if (buRes.error) throw new Error(buRes.error.message);
  return { resources: rRes.data ?? [], branches: bRes.data ?? [], businessUnits: buRes.data ?? [] };
}

const TYPE_LABEL: Record<string, string> = {
  massage_bed: 'Massage Bed',
  rest_room: 'Rest Room',
  hair_chair: 'Hair Chair',
  nail_table: 'Nail Table',
  steam_room: 'Steam Room',
};

function statusBadge(status: string) {
  if (status === 'active') return <Badge className="font-bold">Active</Badge>;
  if (status === 'cleaning')
    return <Badge variant="secondary" className="font-bold">Cleaning</Badge>;
  if (status === 'maintenance')
    return <Badge variant="secondary" className="font-bold">Maintenance</Badge>;
  return <Badge variant="destructive" className="font-bold">Closed</Badge>;
}

export default async function ResourcesPage() {
  const { resources, branches, businessUnits } = await fetchData();

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Resources</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {resources.length} resources across {branches.length} branches
          </p>
        </div>
        <ResourceFormDialog
          branches={branches}
          businessUnits={businessUnits}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Resource
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Type</TableHead>
              <TableHead className="font-bold">Branch</TableHead>
              <TableHead className="font-bold">Zone</TableHead>
              <TableHead className="w-24 font-bold">Capacity</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No resources yet. Add the first bed / room.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              resources.map((r) => {
                const branch = Array.isArray(r.branch) ? r.branch[0] : r.branch;
                const resourceItem: ResourceItem = {
                  id: r.id,
                  branch_id: r.branch_id,
                  resource_type: r.resource_type as ResourceType,
                  resource_name: r.resource_name,
                  location_zone: r.location_zone,
                  capacity: r.capacity,
                  business_unit_id: r.business_unit_id,
                };
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.resource_name}</TableCell>
                    <TableCell className="font-medium">
                      {TYPE_LABEL[r.resource_type] ?? r.resource_type}
                    </TableCell>
                    <TableCell className="font-mono font-bold">
                      {branch?.code ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium text-muted-foreground">
                      {r.location_zone ?? '—'}
                    </TableCell>
                    <TableCell className="font-bold tabular">{r.capacity}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>
                      <ResourceRowActions
                        resource={{ ...resourceItem, status: r.status as 'active' | 'cleaning' | 'maintenance' | 'closed' }}
                        branches={branches}
                        businessUnits={businessUnits}
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
