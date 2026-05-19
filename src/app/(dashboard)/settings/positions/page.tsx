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

async function fetchPositions() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('positions')
    .select('id, code, name, business_unit, active, updated_at')
    .order('code');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function PositionsPage() {
  const items = await fetchPositions();
  const activeCount = items.filter((i) => i.active).length;

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
            {items.length} total · {activeCount} active · HR job titles for employees
          </p>
        </div>
        <PositionFormDialog
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
              <TableHead className="w-24 font-bold">Unit</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No positions yet. Add the first one.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-bold">{p.code}</TableCell>
                  <TableCell className="font-semibold">{p.name}</TableCell>
                  <TableCell className="font-mono font-bold uppercase">{p.business_unit}</TableCell>
                  <TableCell>
                    {p.active ? (
                      <Badge className="font-bold">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-bold">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <PositionRowActions item={p} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
