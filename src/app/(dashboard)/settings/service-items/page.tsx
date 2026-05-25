import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { ServiceItemFormDialog, type ServiceItemRecord } from '@/components/settings/service-item-form-dialog';
import { ServiceItemsTable, type ServiceGroupVM } from '@/components/settings/service-items-table';

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
        service_item_prices ( price_cents, price_class, branch_id, effective_from, effective_to )
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  // Group rows by service_group (items already ordered by group then duration).
  const groupMap = new Map<string, ServiceGroupVM>();
  for (const i of items) {
    const category = Array.isArray(i.category) ? i.category[0] : i.category;
    const slot = i.duration_minutes + i.prep_before_minutes + i.cleanup_after_minutes;
    const normalRows = (i.service_item_prices ?? []).filter((p) => p.price_class === 'Normal' && p.branch_id === null);
    // Current = the segment whose period covers today; future = the next one scheduled to start after today.
    const current = normalRows.find((p) => p.effective_from <= today && p.effective_to >= today) ?? null;
    const future = normalRows
      .filter((p) => p.effective_from > today)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null;
    const priceCents = current?.price_cents ?? null;
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
    groupMap.get(key)!.rows.push({
      id: i.id,
      code: i.code,
      name: i.name,
      duration_minutes: i.duration_minutes,
      slot,
      priceCents,
      future: future ? { price_cents: future.price_cents, effective_from: future.effective_from } : null,
      requiredResourceType: i.required_resource_type,
      active: i.active,
      itemRecord,
    });
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

      <ServiceItemsTable groups={orderedGroups} categories={categories} businessUnits={businessUnits} groupNames={groups} />
    </div>
  );
}
