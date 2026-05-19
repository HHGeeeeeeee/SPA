import Link from 'next/link';
import { ChevronLeft, Plus, AlertCircle } from 'lucide-react';

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
import { DiscountClassFormDialog } from '@/components/settings/discount-class-form-dialog';
import { DiscountClassRowActions } from '@/components/settings/discount-class-row-actions';
import { formatPHP } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function fetchDiscounts() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('discount_classes')
    .select(
      'id, code, description, discount_percent, discount_amount_cents, requires_approval, force_apply, active, updated_at',
    )
    .order('code');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function DiscountClassesPage() {
  const items = await fetchDiscounts();
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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Discount Classes</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {items.length} total · {activeCount} active · Applied at OrderItem (line) level
          </p>
        </div>
        <DiscountClassFormDialog
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
              <TableHead className="w-28 font-bold">Code</TableHead>
              <TableHead className="font-bold">Description</TableHead>
              <TableHead className="w-32 font-bold">Value</TableHead>
              <TableHead className="w-32 font-bold">Flags</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No discount classes yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono font-bold">{d.code}</TableCell>
                  <TableCell className="font-semibold">{d.description}</TableCell>
                  <TableCell className="font-bold tabular">
                    {d.discount_amount_cents > 0
                      ? `-${formatPHP(d.discount_amount_cents)}`
                      : d.discount_percent > 0
                        ? `-${d.discount_percent}%`
                        : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {d.requires_approval && (
                        <Badge variant="destructive" className="font-bold gap-1">
                          <AlertCircle className="size-3" />
                          Approval
                        </Badge>
                      )}
                      {d.force_apply && (
                        <Badge variant="secondary" className="font-bold">
                          Forced
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {d.active ? (
                      <Badge className="font-bold">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-bold">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DiscountClassRowActions item={d} />
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
