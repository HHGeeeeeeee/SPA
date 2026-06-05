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

async function fetchData() {
  const supabase = createServiceClient();
  const [catRes, buRes] = await Promise.all([
    supabase
      .from('service_categories')
      .select(`
        id, code, name, commission_applicable, tip_applicable, revenue_account, required_resource_types, active, updated_at,
        service_category_business_units ( business_unit_id, business_units ( id, code, name ) )
      `)
      .order('code'),
    supabase.from('business_units').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (catRes.error) throw new Error(catRes.error.message);
  if (buRes.error) throw new Error(buRes.error.message);
  return { categories: catRes.data ?? [], businessUnits: buRes.data ?? [] };
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
  const { categories, businessUnits } = await fetchData();
  const activeCount = categories.filter((i) => i.active).length;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
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
            {categories.length} total · {activeCount} active · Groups Service Items
          </p>
        </div>
        <ServiceCategoryFormDialog
          businessUnits={businessUnits}
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
              <TableHead className="font-bold">Business Units</TableHead>
              <TableHead className="w-28 font-bold">Commission</TableHead>
              <TableHead className="w-28 font-bold">Tip</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No categories yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              categories.map((c) => {
                const units = (c.service_category_business_units ?? [])
                  .map((row) => (Array.isArray(row.business_units) ? row.business_units[0] : row.business_units))
                  .filter(Boolean) as { id: string; code: string; name: string }[];
                const categoryItem = {
                  id: c.id,
                  code: c.code,
                  name: c.name,
                  business_unit_ids: units.map((u) => u.id),
                  commission_applicable: c.commission_applicable,
                  tip_applicable: c.tip_applicable,
                  revenue_account: c.revenue_account,
                  required_resource_types: c.required_resource_types ?? [],
                  active: c.active,
                };
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-bold">{c.code}</TableCell>
                    <TableCell className="font-semibold">{c.name}</TableCell>
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
                      <ServiceCategoryRowActions item={categoryItem} businessUnits={businessUnits} />
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
