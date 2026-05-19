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
import { PositionFormDialog } from '@/components/settings/position-form-dialog';
import { PositionRowActions } from '@/components/settings/position-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [posRes, buRes] = await Promise.all([
    supabase
      .from('positions')
      .select(`
        id, code, name, active, updated_at,
        position_business_units ( business_unit_id, business_units ( id, code, name ) )
      `)
      .order('code'),
    supabase.from('business_units').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (posRes.error) throw new Error(posRes.error.message);
  if (buRes.error) throw new Error(buRes.error.message);
  return { positions: posRes.data ?? [], businessUnits: buRes.data ?? [] };
}

export default async function PositionsPage() {
  const { positions, businessUnits } = await fetchData();
  const activeCount = positions.filter((i) => i.active).length;

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Positions</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {positions.length} total · {activeCount} active · HR job titles for employees
          </p>
        </div>
        <PositionFormDialog
          businessUnits={businessUnits}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Position
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48 font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Business Units</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No positions yet. Add the first one.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              positions.map((p) => {
                const units = (p.position_business_units ?? [])
                  .map((row) => (Array.isArray(row.business_units) ? row.business_units[0] : row.business_units))
                  .filter(Boolean) as { id: string; code: string; name: string }[];
                const positionItem = {
                  id: p.id,
                  code: p.code,
                  name: p.name,
                  active: p.active,
                  business_unit_ids: units.map((u) => u.id),
                };
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-bold">{p.code}</TableCell>
                    <TableCell className="font-semibold">{p.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {units.length === 0 ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          units.map((u) => (
                            <Badge key={u.id} variant="secondary" className="font-bold font-mono text-xs uppercase">
                              {u.code}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <PositionRowActions item={positionItem} businessUnits={businessUnits} />
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
