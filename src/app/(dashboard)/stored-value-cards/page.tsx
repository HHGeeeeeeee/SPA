import { Plus, CreditCard } from 'lucide-react';

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
import { IssueCardDialog } from '@/components/stored-value-cards/issue-card-dialog';
import { CardRowActions } from '@/components/stored-value-cards/card-row-actions';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  active: 'default', suspended: 'destructive', expired: 'secondary', refunded: 'secondary', depleted: 'secondary',
};

async function fetchData() {
  const supabase = createServiceClient();
  const [cards, customers, branches, disc, setting] = await Promise.all([
    supabase
      .from('stored_value_cards')
      .select(`
        id, card_no, current_balance_cents, initial_amount_cents, bonus_amount_cents,
        status, issued_at, expires_at,
        customer:customers ( name, phone )
      `)
      .order('issued_at', { ascending: false }),
    supabase.from('customers').select('id, name, phone').eq('status', 'active').order('name'),
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
    supabase.from('discount_classes').select('id, code, description').eq('active', true).order('code'),
    supabase.from('settings').select('value').eq('key', 'stored_value_default_expiry_days').maybeSingle(),
  ]);
  if (cards.error) throw new Error(cards.error.message);
  const defaultExpiryDays = Number(setting.data?.value ?? 365);
  return {
    cards: cards.data ?? [],
    customers: customers.data ?? [],
    branches: branches.data ?? [],
    discountClasses: disc.data ?? [],
    defaultExpiryDays,
  };
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function StoredValueCardsPage() {
  const { cards, customers, branches, discountClasses, defaultExpiryDays } = await fetchData();
  const totalLiability = cards
    .filter((c) => c.status === 'active')
    .reduce((s, c) => s + c.current_balance_cents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Stored Value Cards</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {cards.length} cards · Active liability {peso(totalLiability)}
          </p>
        </div>
        <IssueCardDialog
          customers={customers}
          branches={branches}
          discountClasses={discountClasses}
          defaultExpiryDays={defaultExpiryDays}
          trigger={
            <Button disabled={branches.length === 0}>
              <Plus className="size-4" />
              Issue Card
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Card No</TableHead>
              <TableHead className="font-bold">Customer</TableHead>
              <TableHead className="w-36 font-bold text-right">Balance</TableHead>
              <TableHead className="w-32 font-bold">Issued</TableHead>
              <TableHead className="w-32 font-bold">Expires</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cards.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16">
                  <CreditCard className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">
                    No cards issued yet. Issue one to a customer master record.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              cards.map((c) => {
                const cust = one(c.customer);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-bold">{c.card_no}</TableCell>
                    <TableCell className="font-semibold">
                      {cust?.name ?? '—'}
                      {cust?.phone && <span className="ml-2 font-medium text-muted-foreground">{cust.phone}</span>}
                    </TableCell>
                    <TableCell className="font-extrabold tabular text-right">{peso(c.current_balance_cents)}</TableCell>
                    <TableCell className="font-medium tabular text-sm">{c.issued_at.slice(0, 10)}</TableCell>
                    <TableCell className="font-medium tabular text-sm">{c.expires_at.slice(0, 10)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'} className="font-bold capitalize">
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <CardRowActions card={{ id: c.id, card_no: c.card_no, status: c.status }} />
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
