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
import { CommissionClassFormDialog } from '@/components/settings/commission-class-form-dialog';
import { CommissionClassRowActions } from '@/components/settings/commission-class-row-actions';

export const dynamic = 'force-dynamic';

async function fetchClasses() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('commission_classes')
    .select('id, class_code, name, commission_rate, active, updated_at')
    .order('commission_rate', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function CommissionClassesPage() {
  const items = await fetchClasses();
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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Commission Classes</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {items.length} total · {activeCount} active · Used by Employees as commission tier
          </p>
        </div>
        <CommissionClassFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Class
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32 font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="w-40 font-bold">Rate</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No commission classes yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-bold">{c.class_code}</TableCell>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell className="font-bold tabular">
                    {(c.commission_rate * 100).toFixed(2)}%
                  </TableCell>
                  <TableCell>
                    {c.active ? (
                      <Badge className="font-bold">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-bold">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <CommissionClassRowActions item={c} />
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
