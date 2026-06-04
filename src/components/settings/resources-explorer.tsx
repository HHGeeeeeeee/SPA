'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type ResourceItem, type ResourceType } from '@/components/settings/resource-form-dialog';
import { ResourceRowActions } from '@/components/settings/resource-row-actions';

const ALL = '__all__';

const TYPE_LABEL: Record<string, string> = {
  massage_bed: 'Massage Bed',
  rest_room: 'Rest Room',
  hair_chair: 'Hair Chair',
  nail_station: 'Nail Station',
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

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
  businessUnits: BusinessUnitOption[];
}

export interface ResourceRow {
  id: string;
  branch_id: string;
  branch_code: string | null;
  resource_type: ResourceType;
  resource_name: string;
  location_zone: string | null;
  capacity: number;
  business_unit_id: string | null;
  status: 'active' | 'cleaning' | 'maintenance' | 'closed';
}

interface Props {
  rows: ResourceRow[];
  branches: BranchOption[];
  allBusinessUnits: BusinessUnitOption[];
}

export function ResourcesExplorer({ rows, branches, allBusinessUnits }: Props) {
  const [branch, setBranch] = useState(ALL);

  const branchCodes = useMemo(
    () => Array.from(new Set(branches.map((b) => b.code))).sort(),
    [branches],
  );
  // <SelectValue /> reads labels from items to render the trigger text.
  const branchItems = [{ value: ALL, label: 'All' }, ...branchCodes.map((c) => ({ value: c, label: c }))];

  const visible = useMemo(() => {
    const filtered = branch === ALL ? rows : rows.filter((r) => r.branch_code === branch);
    // Sort by zone, then station name — both natural (numeric-aware) so
    // "2F Bed 2" precedes "2F Bed 10". Blank zones sink to the bottom.
    const collate = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...filtered].sort((a, b) => {
      const za = a.location_zone ?? '';
      const zb = b.location_zone ?? '';
      if (za !== zb) {
        if (!za) return 1;
        if (!zb) return -1;
        return collate(za, zb);
      }
      return collate(a.resource_name, b.resource_name);
    });
  }, [rows, branch]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Branch</Label>
            <Select items={branchItems} value={branch} onValueChange={(v) => v && setBranch(v)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {branchCodes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm font-semibold text-muted-foreground pb-2">
            {visible.length} {visible.length === 1 ? 'station' : 'stations'}
          </p>
        </div>
      </Card>

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
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No service stations match this filter.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              visible.map((r) => {
                const resourceItem: ResourceItem = {
                  id: r.id,
                  branch_id: r.branch_id,
                  resource_type: r.resource_type,
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
                      {r.branch_code ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium text-muted-foreground">
                      {r.location_zone ?? '—'}
                    </TableCell>
                    <TableCell className="font-bold tabular">{r.capacity}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>
                      <ResourceRowActions
                        resource={{ ...resourceItem, status: r.status }}
                        branches={branches}
                        allBusinessUnits={allBusinessUnits}
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
