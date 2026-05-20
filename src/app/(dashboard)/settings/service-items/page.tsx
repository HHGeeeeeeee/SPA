import { Fragment } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Clock } from 'lucide-react';

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
import { ServiceItemFormDialog, type ServiceItemRecord } from '@/components/settings/service-item-form-dialog';
import { ServiceItemRowActions } from '@/components/settings/service-item-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [items, categories, businessUnits] = await Promise.all([
    supabase
      .from('service_items')
      .select(`
        id, code, name, service_group, service_category_id, duration_minutes,
        prep_before_minutes, cleanup_after_minutes,
        required_resource_type, pricing_model,
        commission_applicable, tip_applicable, business_unit_id, active,
        category:service_categories ( code, name ),
        service_item_prices ( price_cents, price_class, branch_id )
      `)
      .order('service_group')
      .order('duration_minutes'),
    supabase.from('service_categories').select('id, code, name').eq('active', true).order('code'),
    supabase.from('business_units').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (categories.error) throw new Error(categories.error.message);
  if (businessUnits.error) throw new Error(businessUnits.error.message);
  const groups = [...new Set((items.data ?? []).map((i) => i.service_group).filter(Boolean) as string[])].sort();
  return {
    items: items.data ?? [],
    categories: categories.data ?? [],
    businessUnits: businessUnits.data ?? [],
    groups,
  };
}

export default async function ServiceItemsPage() {
  const { items, categories, businessUnits, groups } = await fetchData();
  const activeCount = items.filter((i) => i.active).length;

  // Group rows by service_group (items already ordered by group then duration).
  type Row = {
    i: (typeof items)[number];
    slot: number;
    priceCents: number | null;
    itemRecord: ServiceItemRecord;
  };
  const groupMap = new Map<string, { key: string; name: string; categoryCode: string; rows: Row[] }>();
  for (const i of items) {
    const category = Array.isArray(i.category) ? i.category[0] : i.category;
    const slot = i.duration_minutes + i.prep_before_minutes + i.cleanup_after_minutes;
    const normalPrice = (i.service_item_prices ?? []).find(
      (p) => p.price_class === 'Normal' && p.branch_id === null,
    );
    const priceCents = normalPrice?.price_cents ?? null;
    const itemRecord: ServiceItemRecord = {
      id: i.id,
      code: i.code,
      name: i.name,
      service_group: i.service_group,
      service_category_id: i.service_category_id,
      duration_minutes: i.duration_minutes,
      prep_before_minutes: i.prep_before_minutes,
      cleanup_after_minutes: i.cleanup_after_minutes,
      required_resource_type: i.required_resource_type,
      pricing_model: i.pricing_model as ServiceItemRecord['pricing_model'],
      commission_applicable: i.commission_applicable,
      tip_applicable: i.tip_applicable,
      business_unit_id: i.business_unit_id,
      price_cents: priceCents,
    };
    const key = i.service_group ?? i.name;
    if (!groupMap.has(key)) {
      groupMap.set(key, { key, name: key, categoryCode: category?.code ?? '', rows: [] });
    }
    groupMap.get(key)!.rows.push({ i, slot, priceCents, itemRecord });
  }
  const orderedGroups = [...groupMap.values()];

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Service Items</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {items.length} total · {activeCount} active
          </p>
        </div>
        <ServiceItemFormDialog
          categories={categories}
          businessUnits={businessUnits}
          groups={groups}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Service
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Service Group</TableHead>
              <TableHead className="w-24 font-bold">Code</TableHead>
              <TableHead className="w-28 font-bold">Duration</TableHead>
              <TableHead className="w-32 font-bold">Price</TableHead>
              <TableHead className="w-24 font-bold">Slot</TableHead>
              <TableHead className="font-bold">Station</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No service items yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              orderedGroups.map((grp) => (
                <Fragment key={grp.key}>
                  {grp.rows.map((r, idx) => (
                    <TableRow key={r.i.id} className={idx === grp.rows.length - 1 ? 'border-b-2 border-border' : ''}>
                      {idx === 0 && (
                        <TableCell rowSpan={grp.rows.length} className="align-top border-r border-border">
                          <span className="font-extrabold block">{grp.name}</span>
                          <span className="font-mono font-bold text-xs text-muted-foreground uppercase">{grp.categoryCode}</span>
                        </TableCell>
                      )}
                      <TableCell className="font-mono font-bold">{r.i.code}</TableCell>
                      <TableCell className="font-bold tabular">{r.i.duration_minutes} min</TableCell>
                      <TableCell className="font-bold tabular">
                        {r.priceCents != null ? `₱${(r.priceCents / 100).toLocaleString('en-PH')}` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground tabular">
                          <Clock className="size-3" />
                          {r.slot} min
                        </span>
                      </TableCell>
                      <TableCell className="font-mono font-medium text-muted-foreground">
                        {r.i.required_resource_type ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.i.active ? (
                          <Badge className="font-bold">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="font-bold">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <ServiceItemRowActions item={{ ...r.itemRecord, active: r.i.active }} categories={categories} businessUnits={businessUnits} groups={groups} />
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
