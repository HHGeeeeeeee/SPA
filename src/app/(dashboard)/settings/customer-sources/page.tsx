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
import {
  CustomerSourceFormDialog,
  type CustomerSourceItem,
} from '@/components/settings/customer-source-form-dialog';
import { CustomerSourceRowActions } from '@/components/settings/customer-source-row-actions';

export const dynamic = 'force-dynamic';

function formatDiscount(d: { description: string; discount_percent: number; discount_amount_cents: number } | null): string | null {
  if (!d) return null;
  if (d.discount_percent > 0) return `${d.description} - ${d.discount_percent}%`;
  if (d.discount_amount_cents > 0) return `${d.description} - ₱${(d.discount_amount_cents / 100).toLocaleString()}`;
  return d.description;
}

async function fetchData() {
  const supabase = createServiceClient();
  const [cs, bd, dc] = await Promise.all([
    supabase
      .from('customer_sources')
      .select(`
        id, code, name, default_billing_to_id, default_discount_class_id, active,
        billing:billing_destinations ( code, name ),
        discount:discount_classes ( code, description, discount_percent, discount_amount_cents )
      `)
      .order('code'),
    supabase.from('billing_destinations').select('id, code, name').eq('active', true).order('code'),
    supabase.from('discount_classes').select('id, code, description, discount_percent, discount_amount_cents').eq('active', true).order('code'),
  ]);
  if (cs.error) throw new Error(cs.error.message);
  if (bd.error) throw new Error(bd.error.message);
  if (dc.error) throw new Error(dc.error.message);
  return {
    sources: cs.data ?? [],
    billingDestinations: bd.data ?? [],
    discountClasses: dc.data ?? [],
  };
}

export default async function CustomerSourcesPage() {
  const { sources, billingDestinations, discountClasses } = await fetchData();
  const activeCount = sources.filter((s) => s.active).length;

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Customer Sources</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {sources.length} total · {activeCount} active · Used at order creation
          </p>
        </div>
        <CustomerSourceFormDialog
          billingDestinations={billingDestinations}
          discountClasses={discountClasses}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Source
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Default Billing To</TableHead>
              <TableHead className="font-bold">Default Discount</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No customer sources yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              sources.map((s) => {
                const bill = Array.isArray(s.billing) ? s.billing[0] : s.billing;
                const disc = Array.isArray(s.discount) ? s.discount[0] : s.discount;
                const itemRecord: CustomerSourceItem = {
                  id: s.id,
                  code: s.code,
                  name: s.name,
                  default_billing_to_id: s.default_billing_to_id,
                  default_discount_class_id: s.default_discount_class_id,
                };
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-bold">{s.code}</TableCell>
                    <TableCell className="font-semibold">{s.name}</TableCell>
                    <TableCell className="font-medium">
                      {bill ? (
                        <span className="font-mono font-bold">{bill.code}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatDiscount(disc) ? (
                        <Badge variant="secondary" className="font-bold">{formatDiscount(disc)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <CustomerSourceRowActions
                        item={{ ...itemRecord, active: s.active }}
                        billingDestinations={billingDestinations}
                        discountClasses={discountClasses}
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
