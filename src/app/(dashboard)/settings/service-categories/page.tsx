import Link from 'next/link';
import { ChevronLeft, Check, Plus, X } from 'lucide-react';

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
import { ServiceCategoryFormDialog } from '@/components/settings/service-category-form-dialog';
import { ServiceCategoryRowActions } from '@/components/settings/service-category-row-actions';

export const dynamic = 'force-dynamic';

async function fetchCategories() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('service_categories')
    .select('id, code, name, business_unit, commission_applicable, tip_applicable, revenue_account, active, updated_at')
    .order('code');
  if (error) throw new Error(error.message);
  return data ?? [];
}

function Yes({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 text-primary font-bold">
      <Check className="size-4" /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground font-bold">
      <X className="size-4" /> No
    </span>
  );
}

export default async function ServiceCategoriesPage() {
  const items = await fetchCategories();
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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Service Categories</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {items.length} total · {activeCount} active · Groups Service Items
          </p>
        </div>
        <ServiceCategoryFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Category
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
              <TableHead className="w-24 font-bold">Unit</TableHead>
              <TableHead className="w-28 font-bold">Commission</TableHead>
              <TableHead className="w-28 font-bold">Tip</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No categories yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-bold">{c.code}</TableCell>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell className="font-mono font-bold uppercase">{c.business_unit}</TableCell>
                  <TableCell><Yes on={c.commission_applicable} /></TableCell>
                  <TableCell><Yes on={c.tip_applicable} /></TableCell>
                  <TableCell>
                    {c.active ? (
                      <Badge className="font-bold">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="font-bold">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ServiceCategoryRowActions item={c} />
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
